import { createHash } from "node:crypto";
import type { MediaProbe } from "@droploop/media";
import type { DurableJobRepository, RegisteredProviderOutput } from "@droploop/pipeline";
import type { GenerationJob, JobAttempt } from "@droploop/schemas";

const OUTPUT_BUCKET = "project-assets";
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export interface OutputObjectStore {
  uploadImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<"created" | "exists">;
}

export type MaterializedOutput = {
  assetId: string;
  ownerId: string;
  storageBucket: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  probe: MediaProbe;
};

export class OutputRegistrationError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "OutputRegistrationError";
  }
}

export class GeneratedOutputRegistrar {
  constructor(
    private readonly repository: DurableJobRepository,
    private readonly objectStore: OutputObjectStore
  ) {}

  async materialize(
    job: GenerationJob,
    attempt: JobAttempt,
    bytes: Uint8Array,
    probe: MediaProbe
  ): Promise<MaterializedOutput> {
    if (bytes.byteLength === 0) throw new OutputRegistrationError("Generated output is empty.", false);
    if (bytes.byteLength > MAX_OUTPUT_BYTES) {
      throw new OutputRegistrationError(`Generated output exceeds ${MAX_OUTPUT_BYTES} bytes.`, false);
    }
    const ownerId = await this.repository.getProjectOwnerId(job.projectId);
    if (!ownerId) throw new OutputRegistrationError(`Project owner for job ${job.id} does not exist.`, false);
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const mimeType = mimeTypeFor(probe.formatName);
    const filename = `${contentSha256}.${extensionFor(mimeType)}`;
    const assetId = deterministicAssetId(job.id, attempt.id);
    const storagePath = `${ownerId}/${job.projectId}/outputs/${job.id}/${attempt.id}/${filename}`;
    try {
      await this.objectStore.uploadImmutable(storagePath, bytes, mimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown storage failure.";
      throw new OutputRegistrationError(`Immutable output upload failed: ${message}`, true);
    }
    return {
      assetId,
      ownerId,
      storageBucket: OUTPUT_BUCKET,
      storagePath,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      contentSha256,
      probe
    };
  }

  register(
    job: GenerationJob,
    attempt: JobAttempt,
    output: MaterializedOutput,
    materializationLatencyMs: number
  ): Promise<RegisteredProviderOutput> {
    return this.repository.registerProviderOutput({
      ...output,
      jobId: job.id,
      attemptId: attempt.id,
      downloadLatencyMs: materializationLatencyMs
    });
  }
}

function deterministicAssetId(jobId: string, attemptId: string): string {
  const bytes = createHash("sha256").update(`droploop-output:${jobId}:${attemptId}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mimeTypeFor(formatName: string | null): string {
  const formats = new Set((formatName ?? "").split(","));
  if (formats.has("webm")) return "video/webm";
  if (formats.has("mov") && !formats.has("mp4")) return "video/quicktime";
  return "video/mp4";
}

function extensionFor(mimeType: string): string {
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  return "mp4";
}
