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
      "-f", "lavfi", "-i", "color=c=#a0a0a0:s=320x180:r=30:d=1",
      "-f", "lavfi", "-i", "color=c=#606060:s=320x180:r=30:d=1",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath
    ]);
    sourceBytes = new Uint8Array(await readFile(sourcePath));
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("preserves duration while converting a hard boundary into a passing decoded seam", async () => {
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
    expect(before.boundaryMaePercent).toBeGreaterThan(20);
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
