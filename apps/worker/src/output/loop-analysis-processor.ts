import { createHash } from "node:crypto";
import { CURRENT_LOOP_ANALYSIS_POLICY, analyzeVideoLoopBuffer } from "@droploop/media";
import type { LoopAnalysisResult } from "@droploop/media";
import type { DurableJobRepository, StoredLoopAnalysis } from "@droploop/pipeline";
import type { GenerationJob } from "@droploop/schemas";

export interface ValidationObjectStore {
  download(path: string): Promise<Uint8Array>;
}

export type LoopAnalyzer = (
  bytes: Uint8Array,
  filename: string,
  durationSeconds: number,
  frameRate: number
) => Promise<LoopAnalysisResult>;

export class LoopValidationError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "LoopValidationError";
  }
}

export class LoopAnalysisProcessor {
  constructor(
    private readonly repository: DurableJobRepository,
    private readonly objectStore: ValidationObjectStore,
    private readonly analyzer: LoopAnalyzer = analyzeVideoLoopBuffer
  ) {}

  async process(job: GenerationJob): Promise<StoredLoopAnalysis> {
    if (job.status !== "validating" || !job.outputAssetId) {
      throw new LoopValidationError(`Job ${job.id} is not ready for loop analysis.`, false);
    }
    const existing = await this.repository.getLatestLoopAnalysis(job.id);
    if (existing && existing.result.algorithmVersion === CURRENT_LOOP_ANALYSIS_POLICY.algorithmVersion) {
      if (existing.assetId !== job.outputAssetId) {
        throw new LoopValidationError(`Job ${job.id} has loop evidence for a different output asset.`, false);
      }
      return existing;
    }
    const asset = await this.repository.getValidationAsset(job.id);
    if (!asset || asset.assetId !== job.outputAssetId || asset.storageBucket !== "project-assets") {
      throw new LoopValidationError(`Job ${job.id} has no valid private output asset to analyze.`, false);
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.objectStore.download(asset.storagePath);
    } catch (error) {
      throw validationError("Unable to read immutable output for loop analysis", error, true);
    }

    let result: LoopAnalysisResult;
    try {
      result = await this.analyzer(bytes, asset.filename, asset.durationSeconds, asset.frameRate);
    } catch (error) {
      throw validationError("Unable to analyze decoded loop and temporal safety", error, false);
    }
    if (result.algorithmVersion !== CURRENT_LOOP_ANALYSIS_POLICY.algorithmVersion) {
      throw new LoopValidationError(
        `Loop analyzer returned ${result.algorithmVersion}; expected ${CURRENT_LOOP_ANALYSIS_POLICY.algorithmVersion}.`,
        false
      );
    }

    try {
      return await this.repository.registerLoopAnalysis({
        analysisId: deterministicAnalysisId(job.id, asset.assetId, result.algorithmVersion),
        jobId: job.id,
        assetId: asset.assetId,
        result
      });
    } catch (error) {
      throw validationError("Unable to persist loop analysis evidence", error, true);
    }
  }
}

function deterministicAnalysisId(jobId: string, assetId: string, algorithmVersion: string): string {
  const bytes = createHash("sha256").update(`droploop-loop-analysis:${jobId}:${assetId}:${algorithmVersion}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validationError(prefix: string, error: unknown, retryable: boolean): LoopValidationError {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return new LoopValidationError(`${prefix}: ${message}`, retryable);
}
