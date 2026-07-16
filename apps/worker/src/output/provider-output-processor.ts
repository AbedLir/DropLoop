import { createHash } from "node:crypto";
import { probeMediaBuffer } from "@droploop/media";
import type { MediaProbe } from "@droploop/media";
import type { DurableJobRepository } from "@droploop/pipeline";
import type { GenerationJob, JobAttempt } from "@droploop/schemas";

const OUTPUT_BUCKET = "project-assets";
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export type OutputFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OutputObjectStore {
  uploadImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<"created" | "exists">;
}

export type ProviderOutputProcessorOptions = {
  fetch?: OutputFetch;
  probe?: (bytes: Uint8Array, filename: string, expectedKind: "video") => Promise<MediaProbe>;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
};

export type ProcessedProviderOutput = {
  assetId: string;
  downloadLatencyMs: number;
};

export class OutputProcessingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "OutputProcessingError";
  }
}

export class ProviderOutputProcessor {
  private readonly fetchImpl: OutputFetch;
  private readonly probe: NonNullable<ProviderOutputProcessorOptions["probe"]>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    private readonly repository: DurableJobRepository,
    private readonly objectStore: OutputObjectStore,
    options: ProviderOutputProcessorOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.probe = options.probe ?? probeMediaBuffer;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async process(job: GenerationJob): Promise<ProcessedProviderOutput> {
    if (job.status !== "downloading") {
      throw new OutputProcessingError(`Job ${job.id} is not ready to download.`, false);
    }

    const attempt = await this.repository.getLatestAttempt(job.id);
    assertCompletedAttempt(job, attempt);
    const ownerId = await this.repository.getProjectOwnerId(job.projectId);
    if (!ownerId) {
      throw new OutputProcessingError(`Project owner for job ${job.id} does not exist.`, false);
    }

    const startedAt = this.now();
    const bytes = await this.download(attempt.result.previewUrl);
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const probe = await this.inspect(bytes, "provider-output.bin");
    const mimeType = mimeTypeFor(probe.formatName);
    const filename = `${contentSha256}.${extensionFor(mimeType)}`;
    const assetId = deterministicAssetId(job.id, attempt.id);
    const storagePath = `${ownerId}/${job.projectId}/outputs/${job.id}/${attempt.id}/${filename}`;
    try {
      await this.objectStore.uploadImmutable(storagePath, bytes, mimeType);
    } catch (error) {
      throw transientError("Unable to store provider output", error);
    }

    try {
      const downloadLatencyMs = Math.max(0, Math.round(this.now() - startedAt));
      const registered = await this.repository.registerProviderOutput({
        assetId,
        jobId: job.id,
        attemptId: attempt.id,
        ownerId,
        storageBucket: OUTPUT_BUCKET,
        storagePath,
        filename,
        mimeType,
        sizeBytes: bytes.byteLength,
        contentSha256,
        downloadLatencyMs,
        probe
      });
      return {
        assetId: registered.assetId,
        downloadLatencyMs
      };
    } catch (error) {
      throw transientError("Unable to register provider output", error);
    }
  }

  private async download(rawUrl: string): Promise<Uint8Array> {
    const url = validateOutputUrl(rawUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchWithSafeRedirects(url, controller.signal);
      if (!response.ok) {
        throw new OutputProcessingError(
          `Provider output download failed with HTTP ${response.status}.`,
          response.status === 408 || response.status === 429 || response.status >= 500
        );
      }
      const declaredBytes = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredBytes) && declaredBytes > this.maxBytes) {
        throw new OutputProcessingError(`Provider output exceeds ${this.maxBytes} bytes.`, false);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new OutputProcessingError("Provider output is empty.", false);
      }
      if (bytes.byteLength > this.maxBytes) {
        throw new OutputProcessingError(`Provider output exceeds ${this.maxBytes} bytes.`, false);
      }
      return bytes;
    } catch (error) {
      if (error instanceof OutputProcessingError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new OutputProcessingError(`Provider output download timed out after ${this.timeoutMs} ms.`, true);
      }
      throw transientError("Provider output download failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchWithSafeRedirects(initialUrl: URL, signal: AbortSignal): Promise<Response> {
    let url = initialUrl;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const response = await this.fetchImpl(url, { redirect: "manual", signal });
      if (response.status < 300 || response.status >= 400) {
        return response;
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new OutputProcessingError("Provider output redirect did not include a location.", false);
      }
      if (redirectCount === 3) {
        throw new OutputProcessingError("Provider output exceeded the redirect limit.", false);
      }
      url = validateOutputUrl(new URL(location, url).toString());
    }
    throw new OutputProcessingError("Provider output exceeded the redirect limit.", false);
  }

  private async inspect(bytes: Uint8Array, filename: string): Promise<MediaProbe> {
    try {
      return await this.probe(bytes, filename, "video");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown media validation failure.";
      throw new OutputProcessingError(`Provider output is not a valid video: ${message}`, false);
    }
  }
}

function assertCompletedAttempt(job: GenerationJob, attempt: JobAttempt | null): asserts attempt is JobAttempt & {
  result: { previewUrl: string; thumbnailUrl?: string };
} {
  if (!attempt || attempt.jobId !== job.id || attempt.status !== "completed" || !attempt.result) {
    throw new OutputProcessingError(`Job ${job.id} has no completed provider result to download.`, false);
  }
}

function validateOutputUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutputProcessingError("Provider output URL is invalid.", false);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new OutputProcessingError("Provider output URL must be credential-free HTTPS.", false);
  }
  if (isBlockedHostname(url.hostname)) {
    throw new OutputProcessingError("Provider output URL cannot target a local or private host.", false);
  }
  return url;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    /^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(normalized) || /^169\.254\./.test(normalized) ||
    /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized) || /^198\.(?:18|19)\./.test(normalized) ||
    /^0\./.test(normalized) || normalized === "::1" || normalized.startsWith("::ffff:127.") ||
    ((normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) && normalized.includes(":")) ||
    normalized === "metadata.google.internal" || normalized === "instance-data";
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

function transientError(prefix: string, error: unknown): OutputProcessingError {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return new OutputProcessingError(`${prefix}: ${message}`, true);
}
