import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { MediaProbe } from "./index";

export type ProRes4444ExportPolicy = {
  algorithmVersion: string;
  container: "mov";
  videoCodec: "prores_ks";
  profile: "4444";
  alphaPixelFormat: "yuva444p12le";
  opaquePixelFormat: "yuv444p12le";
  preserveAlphaWhenPresent: true;
  stripAudio: true;
};

export type ProRes4444ExportResult = {
  bytes: Uint8Array;
  policy: ProRes4444ExportPolicy;
  alphaPreserved: boolean;
};

export const PRORES_4444_EXPORT_POLICY_V1: Readonly<ProRes4444ExportPolicy> = Object.freeze({
  algorithmVersion: "resolume-prores-4444-v1",
  container: "mov",
  videoCodec: "prores_ks",
  profile: "4444",
  alphaPixelFormat: "yuva444p12le",
  opaquePixelFormat: "yuv444p12le",
  preserveAlphaWhenPresent: true,
  stripAudio: true
});

export class ProRes4444ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProRes4444ExportError";
  }
}

export async function exportVideoForResolumeBuffer(
  bytes: Uint8Array,
  filename: string,
  sourceProbe: MediaProbe,
  policy: ProRes4444ExportPolicy = PRORES_4444_EXPORT_POLICY_V1
): Promise<ProRes4444ExportResult> {
  validateSource(bytes, sourceProbe, policy);
  const directory = await mkdtemp(join(tmpdir(), "droploop-prores-export-"));
  const inputPath = join(directory, basename(filename) || "source.video");
  const outputPath = join(directory, "resolume-delivery.mov");
  const alphaPreserved = sourceProbe.hasAlpha === true;
  try {
    await writeFile(inputPath, bytes, { flag: "wx" });
    await runExport(inputPath, outputPath, alphaPreserved, policy);
    const output = new Uint8Array(await readFile(outputPath));
    if (output.byteLength === 0) throw new ProRes4444ExportError("ProRes export produced an empty video.");
    return { bytes: output, policy: { ...policy }, alphaPreserved };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export function assertProRes4444ExportProbe(
  source: MediaProbe,
  output: MediaProbe,
  alphaPreserved: boolean
): void {
  if (
    output.kind !== "video" ||
    output.videoCodec !== "prores" ||
    !output.formatName?.split(",").includes("mov") ||
    output.durationSeconds === null ||
    output.width === null ||
    output.height === null ||
    output.frameRate === null
  ) {
    throw new ProRes4444ExportError("Export output is not a decodable ProRes MOV video.");
  }
  if (
    source.durationSeconds === null ||
    source.frameRate === null ||
    source.width === null ||
    source.height === null
  ) {
    throw new ProRes4444ExportError("Source media probe is incomplete.");
  }
  const durationTolerance = Math.max(0.05, 2 / source.frameRate);
  if (Math.abs(output.durationSeconds - source.durationSeconds) > durationTolerance) {
    throw new ProRes4444ExportError(
      `ProRes export changed duration from ${source.durationSeconds}s to ${output.durationSeconds}s beyond ${durationTolerance}s tolerance.`
    );
  }
  if (output.width !== source.width || output.height !== source.height) {
    throw new ProRes4444ExportError("ProRes export changed the source dimensions.");
  }
  if (Math.abs(output.frameRate - source.frameRate) > 0.01) {
    throw new ProRes4444ExportError("ProRes export changed the source frame rate.");
  }
  if (alphaPreserved && output.hasAlpha !== true) {
    throw new ProRes4444ExportError("Source alpha was not present in the ProRes 4444 delivery output.");
  }
  if (!alphaPreserved && output.hasAlpha === true) {
    throw new ProRes4444ExportError("Opaque source unexpectedly gained an alpha channel during export.");
  }
}

function validateSource(bytes: Uint8Array, source: MediaProbe, policy: ProRes4444ExportPolicy): void {
  if (bytes.byteLength === 0) throw new ProRes4444ExportError("ProRes export requires non-empty video bytes.");
  if (!policy.algorithmVersion.trim()) throw new ProRes4444ExportError("ProRes export policy version is required.");
  if (source.kind !== "video" || !source.durationSeconds || !source.width || !source.height || !source.frameRate) {
    throw new ProRes4444ExportError("ProRes export requires complete decoded video metadata.");
  }
  if (source.hasAlpha === null) {
    throw new ProRes4444ExportError("ProRes export refuses a source with unknown alpha metadata.");
  }
}

function runExport(
  inputPath: string,
  outputPath: string,
  preserveAlpha: boolean,
  policy: ProRes4444ExportPolicy
): Promise<void> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const pixelFormat = preserveAlpha ? policy.alphaPixelFormat : policy.opaquePixelFormat;
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        "-v", "error", "-i", inputPath,
        "-map", "0:v:0", "-an",
        "-c:v", policy.videoCodec,
        "-profile:v", "4",
        "-pix_fmt", pixelFormat,
        "-vendor", "apl0",
        "-movflags", "+faststart",
        outputPath
      ],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 180_000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new ProRes4444ExportError(`Unable to execute ${policy.algorithmVersion}: ${detail}`));
          return;
        }
        resolve();
      }
    );
  });
}
