import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeVideoLoopBuffer, probeMediaBuffer } from "@droploop/media";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("decoded representative-frame safety evidence", () => {
  let directory: string;
  let flashingBytes: Uint8Array;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "droploop-temporal-safety-test-"));
    const flashingPath = join(directory, "flashing.mp4");
    await runFfmpeg([
      "-v", "error",
      "-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=2",
      "-vf", "negate=enable='lt(mod(t,0.166666),0.083333)'",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", flashingPath
    ]);
    flashingBytes = new Uint8Array(await readFile(flashingPath));
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("rejects a real decoded clip with repeated high-amplitude brightness reversals", async () => {
    const probe = await probeMediaBuffer(flashingBytes, "flashing.mp4", "video");
    const result = await analyzeVideoLoopBuffer(
      flashingBytes,
      "flashing.mp4",
      probe.durationSeconds as number,
      probe.frameRate as number
    );

    expect(result.decision).toBe("repair_required");
    expect(result.sampledFrameCount).toBeGreaterThanOrEqual(20);
    expect(result.maxAdjacentBrightnessJumpPercent).toBeGreaterThan(90);
    expect(result.flashReversalsPerSecond).toBeGreaterThan(3);
    expect(result.brightnessSafetyScore).toBe(0);
    expect(result.flickerSafetyScore).toBe(0);
  });
});

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH?.trim() || "ffmpeg", args, { timeout: 20_000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
