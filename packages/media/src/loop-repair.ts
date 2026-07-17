import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type LoopRepairPolicy = {
  algorithmVersion: string;
  transitionSeconds: number;
  videoCodec: "libx264";
  constantRateFactor: number;
  encoderPreset: "medium";
  pixelFormat: "yuv420p";
  preserveDuration: true;
  stripAudio: true;
  supportsAlpha: false;
};

export type LoopRepairResult = {
  bytes: Uint8Array;
  policy: LoopRepairPolicy;
};

export const LOOP_REPAIR_POLICY_V1: Readonly<LoopRepairPolicy> = Object.freeze({
  algorithmVersion: "cyclic-boundary-crossfade-v1",
  transitionSeconds: 0.5,
  videoCodec: "libx264",
  constantRateFactor: 18,
  encoderPreset: "medium",
  pixelFormat: "yuv420p",
  preserveDuration: true,
  stripAudio: true,
  supportsAlpha: false
});

export class LoopRepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopRepairError";
  }
}

export async function repairVideoLoopBuffer(
  bytes: Uint8Array,
  filename: string,
  durationSeconds: number,
  hasAlpha: boolean,
  policy: LoopRepairPolicy = LOOP_REPAIR_POLICY_V1
): Promise<LoopRepairResult> {
  validateInput(bytes, durationSeconds, hasAlpha, policy);
  const directory = await mkdtemp(join(tmpdir(), "droploop-loop-repair-"));
  const inputPath = join(directory, basename(filename) || "source.video");
  const outputPath = join(directory, "repaired.mp4");
  try {
    await writeFile(inputPath, bytes, { flag: "wx" });
    await runRepair(inputPath, outputPath, durationSeconds, policy);
    const output = new Uint8Array(await readFile(outputPath));
    if (output.byteLength === 0) throw new LoopRepairError("Loop repair produced an empty video.");
    return { bytes: output, policy: { ...policy } };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function runRepair(
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  policy: LoopRepairPolicy
): Promise<void> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const transition = policy.transitionSeconds;
  const middleEnd = durationSeconds - transition;
  const speedFactor = durationSeconds / (durationSeconds - transition);
  const filter = [
    "[0:v]split=3[midin][tailin][headin]",
    `[midin]trim=start=${decimal(transition)}:end=${decimal(middleEnd)},setpts=PTS-STARTPTS,settb=AVTB[mid]`,
    `[tailin]trim=start=${decimal(middleEnd)}:end=${decimal(durationSeconds)},setpts=PTS-STARTPTS,settb=AVTB[tail]`,
    `[headin]trim=start=0:end=${decimal(transition)},setpts=PTS-STARTPTS,settb=AVTB[head]`,
    `[tail][head]xfade=transition=fade:duration=${decimal(transition)}:offset=0[seam]`,
    `[mid][seam]concat=n=2:v=1:a=0,setpts=${decimal(speedFactor)}*PTS[out]`
  ].join(";");

  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        "-v", "error", "-i", inputPath,
        "-filter_complex", filter,
        "-map", "[out]", "-an",
        "-c:v", policy.videoCodec,
        "-preset", policy.encoderPreset,
        "-crf", String(policy.constantRateFactor),
        "-pix_fmt", policy.pixelFormat,
        "-movflags", "+faststart",
        outputPath
      ],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 120_000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new LoopRepairError(`Unable to execute ${policy.algorithmVersion}: ${detail}`));
          return;
        }
        resolve();
      }
    );
  });
}

function validateInput(
  bytes: Uint8Array,
  durationSeconds: number,
  hasAlpha: boolean,
  policy: LoopRepairPolicy
): void {
  if (bytes.byteLength === 0) throw new LoopRepairError("Loop repair requires non-empty video bytes.");
  if (!policy.algorithmVersion.trim()) throw new LoopRepairError("Loop repair algorithm version is required.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= policy.transitionSeconds * 2) {
    throw new LoopRepairError(
      `Loop repair requires duration greater than ${policy.transitionSeconds * 2} seconds for this policy.`
    );
  }
  if (!Number.isFinite(policy.transitionSeconds) || policy.transitionSeconds <= 0) {
    throw new LoopRepairError("Loop repair transition must be a positive duration.");
  }
  if (hasAlpha && !policy.supportsAlpha) {
    throw new LoopRepairError(`${policy.algorithmVersion} does not support alpha video; source was preserved unchanged.`);
  }
}

function decimal(value: number): string {
  return value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
}
