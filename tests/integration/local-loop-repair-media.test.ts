import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOOP_REPAIR_POLICY_V1,
  analyzeVideoLoopBuffer,
  probeMediaBuffer,
  repairVideoLoopBuffer
} from "@droploop/media";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("local Loop Doctor media transform", () => {
  let directory: string;
  let sourceBytes: Uint8Array;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "droploop-loop-repair-test-"));
    const sourcePath = join(directory, "source.mp4");
    await runFfmpeg([
      "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=4",
      "-vf", "eq=brightness='0.12*t/4':eval=frame:contrast=0.9:saturation=1.1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath
    ]);
    sourceBytes = new Uint8Array(await readFile(sourcePath));
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("preserves duration while converting a non-looping source boundary into a passing seam window", async () => {
    const sourceProbe = await probeMediaBuffer(sourceBytes, "source.mp4", "video");
    const before = await analyzeVideoLoopBuffer(
      sourceBytes,
      "source.mp4",
      sourceProbe.durationSeconds as number,
      sourceProbe.frameRate as number
    );

    const repaired = await repairVideoLoopBuffer(
      sourceBytes,
      "source.mp4",
      sourceProbe.durationSeconds as number,
      sourceProbe.hasAlpha as boolean
    );
    const repairedProbe = await probeMediaBuffer(repaired.bytes, "repaired.mp4", "video");
    const after = await analyzeVideoLoopBuffer(
      repaired.bytes,
      "repaired.mp4",
      repairedProbe.durationSeconds as number,
      repairedProbe.frameRate as number
    );

    expect(repaired.policy).toEqual(LOOP_REPAIR_POLICY_V1);
    expect(before.decision).toBe("repair_required");
    expect(before.boundaryMaePercent).toBeGreaterThan(12);
    expect(after.reasons).toEqual([]);
    expect(after.decision).toBe("pass");
    expect(after.boundaryMaePercent).toBeLessThan(before.boundaryMaePercent);
    expect(after.blackFrameCount).toBe(0);
    expect(after.flashReversalCount).toBe(0);
    expect(repairedProbe.durationSeconds).toBeCloseTo(sourceProbe.durationSeconds as number, 1);
    expect(repairedProbe).toMatchObject({ videoCodec: "h264", pixelFormat: "yuv420p", hasAlpha: false });
  }, 30_000);

  it("fails closed for alpha input under the explicit v1 policy", async () => {
    await expect(repairVideoLoopBuffer(sourceBytes, "alpha.mov", 2, true)).rejects.toThrow(
      "does not support alpha video; source was preserved unchanged"
    );
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
