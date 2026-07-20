import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type LoopAnalysisPolicy = {
  algorithmVersion: string;
  frameWidth: number;
  frameHeight: number;
  maxBoundaryMaePercent: number;
  maxBrightnessJumpPercent: number;
  blackFrameLumaFloorPercent: number;
};

export type LoopSafetyPolicy = LoopAnalysisPolicy & {
  sampleFramesPerSecond: number;
  maxRepresentativeFrames: number;
  maxBlackFrameRatioPercent: number;
  maxAdjacentBrightnessJumpPercent: number;
  flashBrightnessDeltaPercent: number;
  maxFlashReversalsPerSecond: number;
};

export type LoopAnalysisResult = {
  algorithmVersion: string;
  decision: "pass" | "repair_required";
  loopScore: number;
  boundaryMaePercent: number;
  firstFrameLumaPercent: number;
  lastFrameLumaPercent: number;
  brightnessJumpPercent: number;
  firstFrameBlack: boolean;
  lastFrameBlack: boolean;
  reasons: string[];
  policy: LoopAnalysisPolicy;
};

export type LoopSafetyAnalysisResult = Omit<LoopAnalysisResult, "policy"> & {
  sampleFramesPerSecond: number;
  sampledFrameCount: number;
  blackFrameCount: number;
  blackFrameRatioPercent: number;
  maxAdjacentBrightnessJumpPercent: number;
  p95AdjacentBrightnessJumpPercent: number;
  flashReversalCount: number;
  flashReversalsPerSecond: number;
  brightnessSafetyScore: number;
  flickerSafetyScore: number;
  policy: LoopSafetyPolicy;
};

export const LOOP_ANALYSIS_POLICY_V1: Readonly<LoopAnalysisPolicy> = Object.freeze({
  algorithmVersion: "boundary-gray-mae-v1",
  frameWidth: 64,
  frameHeight: 64,
  maxBoundaryMaePercent: 12,
  maxBrightnessJumpPercent: 8,
  blackFrameLumaFloorPercent: 2
});

export const LOOP_ANALYSIS_POLICY_V2: Readonly<LoopSafetyPolicy> = Object.freeze({
  ...LOOP_ANALYSIS_POLICY_V1,
  algorithmVersion: "boundary-temporal-gray-v2",
  sampleFramesPerSecond: 12,
  maxRepresentativeFrames: 240,
  maxBlackFrameRatioPercent: 0,
  maxAdjacentBrightnessJumpPercent: 35,
  flashBrightnessDeltaPercent: 18,
  maxFlashReversalsPerSecond: 3
});

export const CURRENT_LOOP_ANALYSIS_POLICY = LOOP_ANALYSIS_POLICY_V2;

export class LoopAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopAnalysisError";
  }
}

export async function analyzeVideoLoopBuffer(
  bytes: Uint8Array,
  filename: string,
  durationSeconds: number,
  frameRate: number,
  policy: LoopSafetyPolicy = LOOP_ANALYSIS_POLICY_V2
): Promise<LoopSafetyAnalysisResult> {
  if (bytes.byteLength === 0) throw new LoopAnalysisError("Loop analysis requires non-empty video bytes.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new LoopAnalysisError("Loop analysis requires a positive video duration.");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new LoopAnalysisError("Loop analysis requires a positive video frame rate.");
  }
  validateSafetyPolicy(policy);

  const directory = await mkdtemp(join(tmpdir(), "droploop-loop-analysis-"));
  const filePath = join(directory, basename(filename) || "provider-output.video");
  try {
    await writeFile(filePath, bytes, { flag: "wx" });
    const lastFrameTimestamp = Math.max(0, durationSeconds - 1 / frameRate);
    const sampleFramesPerSecond = Math.min(
      policy.sampleFramesPerSecond,
      policy.maxRepresentativeFrames / durationSeconds
    );
    const [firstFrame, lastFrame, representativeFrames] = await Promise.all([
      decodeGrayFrame(filePath, 0, policy),
      decodeGrayFrame(filePath, lastFrameTimestamp, policy),
      decodeRepresentativeFrames(filePath, durationSeconds, sampleFramesPerSecond, policy)
    ]);
    return evaluateLoopSafety(
      firstFrame,
      lastFrame,
      representativeFrames,
      durationSeconds,
      sampleFramesPerSecond,
      policy
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export function evaluateLoopBoundary(
  firstFrame: Uint8Array,
  lastFrame: Uint8Array,
  policy: LoopAnalysisPolicy = LOOP_ANALYSIS_POLICY_V1
): LoopAnalysisResult {
  validatePolicy(policy);
  const boundary = measureBoundary(firstFrame, lastFrame, policy);
  return {
    algorithmVersion: policy.algorithmVersion,
    decision: boundary.reasons.length === 0 ? "pass" : "repair_required",
    loopScore: Math.max(0, Math.round(100 - boundary.boundaryMaePercent)),
    ...boundary,
    policy: { ...policy }
  };
}

export function evaluateLoopSafety(
  firstFrame: Uint8Array,
  lastFrame: Uint8Array,
  representativeFrames: readonly Uint8Array[],
  durationSeconds: number,
  sampleFramesPerSecond: number,
  policy: LoopSafetyPolicy = LOOP_ANALYSIS_POLICY_V2
): LoopSafetyAnalysisResult {
  validateSafetyPolicy(policy);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new LoopAnalysisError("Temporal loop evidence requires a positive duration.");
  }
  if (!Number.isFinite(sampleFramesPerSecond) || sampleFramesPerSecond <= 0) {
    throw new LoopAnalysisError("Temporal loop evidence requires a positive sample rate.");
  }
  if (representativeFrames.length < 2 || representativeFrames.length > policy.maxRepresentativeFrames + 1) {
    throw new LoopAnalysisError(
      `Temporal loop evidence requires between 2 and ${policy.maxRepresentativeFrames + 1} representative frames.`
    );
  }

  const boundary = measureBoundary(firstFrame, lastFrame, policy);
  const expectedBytes = policy.frameWidth * policy.frameHeight;
  const lumaPercentages = representativeFrames.map((frame) => {
    assertFrameSize(frame, expectedBytes, "Representative frames");
    return frameLumaPercent(frame);
  });
  const blackFrameCount = lumaPercentages.filter((luma) => luma <= policy.blackFrameLumaFloorPercent).length;
  const blackFrameRatioPercent = roundMetric((blackFrameCount / representativeFrames.length) * 100);
  const brightnessJumps = lumaPercentages.slice(1).map((luma, index) =>
    roundMetric(Math.abs(luma - (lumaPercentages[index] ?? luma)))
  );
  const maxAdjacentBrightnessJumpPercent = Math.max(...brightnessJumps, 0);
  const p95AdjacentBrightnessJumpPercent = percentile(brightnessJumps, 0.95);
  const signedBrightnessDeltas = lumaPercentages.slice(1).map((luma, index) =>
    roundMetric(luma - (lumaPercentages[index] ?? luma))
  );
  let flashReversalCount = 0;
  for (let index = 1; index < signedBrightnessDeltas.length; index += 1) {
    const previous = signedBrightnessDeltas[index - 1] ?? 0;
    const current = signedBrightnessDeltas[index] ?? 0;
    if (
      Math.sign(previous) !== Math.sign(current) &&
      Math.abs(previous) >= policy.flashBrightnessDeltaPercent &&
      Math.abs(current) >= policy.flashBrightnessDeltaPercent
    ) {
      flashReversalCount += 1;
    }
  }
  const analyzedDurationSeconds = Math.max(durationSeconds, representativeFrames.length / sampleFramesPerSecond);
  const flashReversalsPerSecond = roundMetric(flashReversalCount / analyzedDurationSeconds);
  const reasons = [...boundary.reasons];
  if (blackFrameRatioPercent > policy.maxBlackFrameRatioPercent) {
    reasons.push(
      `Representative black-frame ratio ${blackFrameRatioPercent}% exceeds ${policy.maxBlackFrameRatioPercent}%.`
    );
  }
  if (maxAdjacentBrightnessJumpPercent > policy.maxAdjacentBrightnessJumpPercent) {
    reasons.push(
      `Maximum sampled brightness jump ${maxAdjacentBrightnessJumpPercent}% exceeds ${policy.maxAdjacentBrightnessJumpPercent}%.`
    );
  }
  if (flashReversalsPerSecond > policy.maxFlashReversalsPerSecond) {
    reasons.push(
      `Rapid brightness reversals ${flashReversalsPerSecond}/s exceed ${policy.maxFlashReversalsPerSecond}/s.`
    );
  }

  return {
    algorithmVersion: policy.algorithmVersion,
    decision: reasons.length === 0 ? "pass" : "repair_required",
    loopScore: Math.max(0, Math.round(100 - boundary.boundaryMaePercent)),
    ...boundary,
    reasons,
    sampleFramesPerSecond: roundMetric(sampleFramesPerSecond),
    sampledFrameCount: representativeFrames.length,
    blackFrameCount,
    blackFrameRatioPercent,
    maxAdjacentBrightnessJumpPercent,
    p95AdjacentBrightnessJumpPercent,
    flashReversalCount,
    flashReversalsPerSecond,
    brightnessSafetyScore: Math.max(
      0,
      Math.round(100 - maxAdjacentBrightnessJumpPercent - blackFrameRatioPercent)
    ),
    flickerSafetyScore: Math.max(
      0,
      Math.round(100 - (flashReversalsPerSecond / policy.maxFlashReversalsPerSecond) * 100)
    ),
    policy: { ...policy }
  };
}

function measureBoundary(firstFrame: Uint8Array, lastFrame: Uint8Array, policy: LoopAnalysisPolicy) {
  const expectedBytes = policy.frameWidth * policy.frameHeight;
  assertFrameSize(firstFrame, expectedBytes, "Decoded boundary frames");
  assertFrameSize(lastFrame, expectedBytes, "Decoded boundary frames");

  let absoluteDifference = 0;
  for (let index = 0; index < expectedBytes; index += 1) {
    absoluteDifference += Math.abs((firstFrame[index] ?? 0) - (lastFrame[index] ?? 0));
  }
  const boundaryMaePercent = percent(absoluteDifference / expectedBytes);
  const firstFrameLumaPercent = frameLumaPercent(firstFrame);
  const lastFrameLumaPercent = frameLumaPercent(lastFrame);
  const brightnessJumpPercent = roundMetric(Math.abs(firstFrameLumaPercent - lastFrameLumaPercent));
  const firstFrameBlack = firstFrameLumaPercent <= policy.blackFrameLumaFloorPercent;
  const lastFrameBlack = lastFrameLumaPercent <= policy.blackFrameLumaFloorPercent;
  const reasons: string[] = [];
  if (boundaryMaePercent > policy.maxBoundaryMaePercent) {
    reasons.push(`Boundary MAE ${boundaryMaePercent}% exceeds ${policy.maxBoundaryMaePercent}%.`);
  }
  if (brightnessJumpPercent > policy.maxBrightnessJumpPercent) {
    reasons.push(`Boundary brightness jump ${brightnessJumpPercent}% exceeds ${policy.maxBrightnessJumpPercent}%.`);
  }
  if (firstFrameBlack) reasons.push("First decoded frame is black or near-black.");
  if (lastFrameBlack) reasons.push("Last decoded frame is black or near-black.");
  return {
    boundaryMaePercent,
    firstFrameLumaPercent,
    lastFrameLumaPercent,
    brightnessJumpPercent,
    firstFrameBlack,
    lastFrameBlack,
    reasons
  };
}

function decodeGrayFrame(filePath: string, timestampSeconds: number, policy: LoopAnalysisPolicy): Promise<Uint8Array> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const frameBytes = policy.frameWidth * policy.frameHeight;
  const filter = `scale=${policy.frameWidth}:${policy.frameHeight}:flags=area,format=gray`;
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        "-v", "error", "-i", filePath, "-ss", timestampSeconds.toFixed(6),
        "-frames:v", "1", "-vf", filter, "-f", "rawvideo", "pipe:1"
      ],
      { encoding: null, maxBuffer: frameBytes * 2, timeout: 20_000 },
      (error, stdout) => {
        if (error) {
          reject(new LoopAnalysisError(`Unable to decode loop boundary frame: ${error.message}`));
          return;
        }
        const frame = new Uint8Array(stdout);
        if (frame.byteLength !== frameBytes) {
          reject(new LoopAnalysisError(`Decoded loop boundary frame has ${frame.byteLength} bytes; expected ${frameBytes}.`));
          return;
        }
        resolve(frame);
      }
    );
  });
}

function decodeRepresentativeFrames(
  filePath: string,
  durationSeconds: number,
  sampleFramesPerSecond: number,
  policy: LoopSafetyPolicy
): Promise<Uint8Array[]> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const frameBytes = policy.frameWidth * policy.frameHeight;
  const filter = [
    `fps=${sampleFramesPerSecond.toFixed(6)}`,
    `scale=${policy.frameWidth}:${policy.frameHeight}:flags=area`,
    "format=gray"
  ].join(",");
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ["-v", "error", "-i", filePath, "-t", durationSeconds.toFixed(6), "-vf", filter, "-f", "rawvideo", "pipe:1"],
      {
        encoding: null,
        maxBuffer: frameBytes * (policy.maxRepresentativeFrames + 2),
        timeout: 30_000
      },
      (error, stdout) => {
        if (error) {
          reject(new LoopAnalysisError(`Unable to decode representative frames: ${error.message}`));
          return;
        }
        const bytes = new Uint8Array(stdout);
        if (bytes.byteLength % frameBytes !== 0) {
          reject(new LoopAnalysisError("Representative frame stream ended with an incomplete grayscale frame."));
          return;
        }
        const frames: Uint8Array[] = [];
        for (let offset = 0; offset < bytes.byteLength; offset += frameBytes) {
          frames.push(bytes.slice(offset, offset + frameBytes));
        }
        if (frames.length < 2 || frames.length > policy.maxRepresentativeFrames + 1) {
          reject(new LoopAnalysisError(`Decoded ${frames.length} representative frames; expected a bounded multi-frame sample.`));
          return;
        }
        resolve(frames);
      }
    );
  });
}

function assertFrameSize(frame: Uint8Array, expectedBytes: number, label: string): void {
  if (frame.byteLength !== expectedBytes) {
    throw new LoopAnalysisError(`${label} must each contain ${expectedBytes} grayscale pixels.`);
  }
}

function frameLumaPercent(frame: Uint8Array): number {
  let luma = 0;
  for (const value of frame) luma += value;
  return percent(luma / frame.byteLength);
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function percent(meanByteValue: number): number {
  return roundMetric((meanByteValue / 255) * 100);
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function validateSafetyPolicy(policy: LoopSafetyPolicy): void {
  validatePolicy(policy);
  if (!Number.isFinite(policy.sampleFramesPerSecond) || policy.sampleFramesPerSecond <= 0) {
    throw new LoopAnalysisError("sampleFramesPerSecond must be positive.");
  }
  if (!Number.isInteger(policy.maxRepresentativeFrames) || policy.maxRepresentativeFrames < 2) {
    throw new LoopAnalysisError("maxRepresentativeFrames must be an integer of at least 2.");
  }
  for (const [name, value] of Object.entries({
    maxBlackFrameRatioPercent: policy.maxBlackFrameRatioPercent,
    maxAdjacentBrightnessJumpPercent: policy.maxAdjacentBrightnessJumpPercent,
    flashBrightnessDeltaPercent: policy.flashBrightnessDeltaPercent
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new LoopAnalysisError(`${name} must be between 0 and 100.`);
    }
  }
  if (!Number.isFinite(policy.maxFlashReversalsPerSecond) || policy.maxFlashReversalsPerSecond <= 0) {
    throw new LoopAnalysisError("maxFlashReversalsPerSecond must be positive.");
  }
}

function validatePolicy(policy: LoopAnalysisPolicy): void {
  if (!policy.algorithmVersion.trim()) throw new LoopAnalysisError("Loop analysis algorithm version is required.");
  if (!Number.isInteger(policy.frameWidth) || policy.frameWidth <= 0 || !Number.isInteger(policy.frameHeight) || policy.frameHeight <= 0) {
    throw new LoopAnalysisError("Loop analysis frame dimensions must be positive integers.");
  }
  for (const [name, value] of Object.entries({
    maxBoundaryMaePercent: policy.maxBoundaryMaePercent,
    maxBrightnessJumpPercent: policy.maxBrightnessJumpPercent,
    blackFrameLumaFloorPercent: policy.blackFrameLumaFloorPercent
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new LoopAnalysisError(`${name} must be between 0 and 100.`);
    }
  }
}
