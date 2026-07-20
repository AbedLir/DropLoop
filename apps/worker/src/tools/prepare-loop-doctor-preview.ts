import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeVideoLoopBuffer, probeMediaBuffer, repairVideoLoopBuffer } from "@droploop/media";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const outputDirectory = resolve(repoRoot, "apps/web/public/acceptance/loop-doctor");
const sourcePath = resolve(outputDirectory, "before.mp4");
const repairedPath = resolve(outputDirectory, "after.mp4");
const evidencePath = resolve(outputDirectory, "evidence.json");

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

await runFfmpeg([
  "-v", "error",
  "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4",
  "-vf", "eq=brightness='0.12*t/4':eval=frame:contrast=0.9:saturation=1.1",
  "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", sourcePath
]);

const sourceBytes = new Uint8Array(await readFile(sourcePath));
const sourceProbe = await probeMediaBuffer(sourceBytes, "before.mp4", "video");
const durationSeconds = requireNumber(sourceProbe.durationSeconds, "source duration");
const frameRate = requireNumber(sourceProbe.frameRate, "source frame rate");
const before = await analyzeVideoLoopBuffer(sourceBytes, "before.mp4", durationSeconds, frameRate);
const repaired = await repairVideoLoopBuffer(
  sourceBytes,
  "before.mp4",
  durationSeconds,
  sourceProbe.hasAlpha === true
);
await writeFile(repairedPath, repaired.bytes);

const repairedProbe = await probeMediaBuffer(repaired.bytes, "after.mp4", "video");
const after = await analyzeVideoLoopBuffer(
  repaired.bytes,
  "after.mp4",
  requireNumber(repairedProbe.durationSeconds, "repaired duration"),
  requireNumber(repairedProbe.frameRate, "repaired frame rate")
);

if (before.decision !== "repair_required" || after.decision !== "pass") {
  throw new Error(
    `Acceptance fixture must prove repair_required -> pass; received ${before.decision} -> ${after.decision}.`
  );
}

await writeFile(evidencePath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  analyzerVersion: after.algorithmVersion,
  repairVersion: repaired.policy.algorithmVersion,
  sourceSha256: sha256(sourceBytes),
  repairedSha256: sha256(repaired.bytes),
  sourceProbe,
  repairedProbe,
  before,
  after,
  caveat: "P0-D heuristic evidence for human review; not medical or venue safety certification."
}, null, 2));

process.stdout.write(`Loop Doctor acceptance fixture ready at ${outputDirectory}\n`);

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(process.env.FFMPEG_PATH?.trim() || "ffmpeg", args, { timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolvePromise();
    });
  });
}

function requireNumber(value: number | null, label: string): number {
  if (value === null) throw new Error(`Acceptance fixture is missing ${label}.`);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
