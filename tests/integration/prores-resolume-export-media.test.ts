import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRORES_4444_EXPORT_POLICY_V1,
  assertProRes4444ExportProbe,
  exportVideoForResolumeBuffer,
  probeMediaBuffer
} from "@droploop/media";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Resolume ProRes 4444 delivery transform", () => {
  let directory: string;
  let alphaSource: Uint8Array;
  let opaqueSource: Uint8Array;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "droploop-prores-export-test-"));
    const alphaPath = join(directory, "alpha-source.mov");
    const opaquePath = join(directory, "opaque-source.mp4");
    await runFfmpeg([
      "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2",
      "-vf", "format=rgba,colorchannelmixer=aa=0.5",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", alphaPath
    ]);
    await runFfmpeg([
      "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", opaquePath
    ]);
    alphaSource = new Uint8Array(await readFile(alphaPath));
    opaqueSource = new Uint8Array(await readFile(opaquePath));
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("creates a decodable ProRes 4444 MOV and preserves a verified alpha channel", async () => {
    const sourceProbe = await probeMediaBuffer(alphaSource, "alpha-source.mov", "video");
    const exported = await exportVideoForResolumeBuffer(alphaSource, "alpha-source.mov", sourceProbe);
    const outputProbe = await probeMediaBuffer(exported.bytes, "resolume.mov", "video");

    expect(sourceProbe.hasAlpha).toBe(true);
    expect(exported.policy).toEqual(PRORES_4444_EXPORT_POLICY_V1);
    expect(exported.alphaPreserved).toBe(true);
    expect(outputProbe).toMatchObject({ videoCodec: "prores", hasAlpha: true, pixelFormat: "yuva444p12le" });
    expect(() => assertProRes4444ExportProbe(sourceProbe, outputProbe, exported.alphaPreserved)).not.toThrow();
  }, 45_000);

  it("keeps an opaque source explicitly opaque instead of claiming alpha", async () => {
    const sourceProbe = await probeMediaBuffer(opaqueSource, "opaque-source.mp4", "video");
    const exported = await exportVideoForResolumeBuffer(opaqueSource, "opaque-source.mp4", sourceProbe);
    const outputProbe = await probeMediaBuffer(exported.bytes, "resolume.mov", "video");

    expect(sourceProbe.hasAlpha).toBe(false);
    expect(exported.alphaPreserved).toBe(false);
    expect(outputProbe).toMatchObject({ videoCodec: "prores", hasAlpha: false, pixelFormat: "yuv444p12le" });
    expect(() => assertProRes4444ExportProbe(sourceProbe, outputProbe, exported.alphaPreserved)).not.toThrow();
  }, 45_000);
});

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH?.trim() || "ffmpeg", args, { timeout: 45_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve();
    });
  });
}
