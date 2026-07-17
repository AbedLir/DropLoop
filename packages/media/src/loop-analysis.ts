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

export const LOOP_ANALYSIS_POLICY_V1: Readonly<LoopAnalysisPolicy> = Object.freeze({
  algorithmVersion: "boundary-gray-mae-v1",
  frameWidth: 64,
  frameHeight: 64,
  maxBoundaryMaePercent: 12,
  maxBrightnessJumpPercent: 8,
  blackFrameLumaFloorPercent: 2
});

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
  policy: LoopAnalysisPolicy = LOOP_ANALYSIS_POLICY_V1
): Promise<LoopAnalysisResult> {
  if (bytes.byteLength === 0) throw new LoopAnalysisError("Loop analysis requires non-empty video bytes.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new LoopAnalysisError("Loop analysis requires a positive video duration.");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new LoopAnalysisError("Loop analysis requires a positive video frame rate.");
  }
  validatePolicy(policy);

  const directory = await mkdtemp(join(tmpdir(), "droploop-loop-analysis-"));
  const filePath = join(directory, basename(filename) || "provider-output.video");
  try {
    await writeFile(filePath, bytes, { flag: "wx" });
    const lastFrameTimestamp = Math.max(0, durationSeconds - 1 / frameRate);
    const [firstFrame, lastFrame] = await Promise.all([
      decodeGrayFrame(filePath, 0, policy),
      decodeGrayFrame(filePath, lastFrameTimestamp, policy)
    ]);
    return evaluateLoopBoundary(firstFrame, lastFrame, policy);
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
  const expectedBytes = policy.frameWidth * policy.frameHeight;
  if (firstFrame.byteLength !== expectedBytes || lastFrame.byteLength !== expectedBytes) {
    throw new LoopAnalysisError(`Decoded boundary frames must each contain ${expectedBytes} grayscale pixels.`);
  }

  let absoluteDifference = 0;
  let firstLuma = 0;
  let lastLuma = 0;
  for (let index = 0; index < expectedBytes; index += 1) {
    const first = firstFrame[index] ?? 0;
    const last = lastFrame[index] ?? 0;
    absoluteDifference += Math.abs(first - last);
    firstLuma += first;
    lastLuma += last;
  }

  const boundaryMaePercent = percent(absoluteDifference / expectedBytes);
  const firstFrameLumaPercent = percent(firstLuma / expectedBytes);
  const lastFrameLumaPercent = percent(lastLuma / expectedBytes);
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
    algorithmVersion: policy.algorithmVersion,
    decision: reasons.length === 0 ? "pass" : "repair_required",
    loopScore: Math.max(0, Math.round(100 - boundaryMaePercent)),
    boundaryMaePercent,
    firstFrameLumaPercent,
    lastFrameLumaPercent,
    brightnessJumpPercent,
    firstFrameBlack,
    lastFrameBlack,
    reasons,
    policy: { ...policy }
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

function percent(meanByteValue: number): number {
  return roundMetric((meanByteValue / 255) * 100);
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
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
