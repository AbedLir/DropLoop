import {
  LOOP_REPAIR_POLICY_V1,
  probeMediaBuffer,
  repairVideoLoopBuffer,
  type LoopRepairResult,
  type MediaProbe
} from "@droploop/media";
import type { DurableJobRepository } from "@droploop/pipeline";
import type { GenerationJob, JobAttempt } from "@droploop/schemas";
import {
  GeneratedOutputRegistrar,
  OutputRegistrationError,
  type OutputObjectStore
} from "./generated-output-registrar";

export const LOCAL_LOOP_REPAIR_PROVIDER = "loop-doctor-local";
export const LOCAL_LOOP_REPAIR_MODEL = LOOP_REPAIR_POLICY_V1.algorithmVersion;

export interface RepairObjectStore extends OutputObjectStore {
  download(path: string): Promise<Uint8Array>;
}

export type LoopRepairer = (
  bytes: Uint8Array,
  filename: string,
  durationSeconds: number,
  hasAlpha: boolean
) => Promise<LoopRepairResult>;

export type LocalLoopRepairProcessorOptions = {
  repair?: LoopRepairer;
  probe?: (bytes: Uint8Array, filename: string, expectedKind: "video") => Promise<MediaProbe>;
  now?: () => number;
};

export type ProcessedLocalRepair = {
  assetId: string;
  materializationLatencyMs: number;
};

export class LocalLoopRepairError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "LocalLoopRepairError";
  }
}

export class LocalLoopRepairProcessor {
  private readonly repair: LoopRepairer;
  private readonly probe: NonNullable<LocalLoopRepairProcessorOptions["probe"]>;
  private readonly now: () => number;

  constructor(
    private readonly repository: DurableJobRepository,
    private readonly objectStore: RepairObjectStore,
    options: LocalLoopRepairProcessorOptions = {}
  ) {
    this.repair = options.repair ?? repairVideoLoopBuffer;
    this.probe = options.probe ?? probeMediaBuffer;
    this.now = options.now ?? Date.now;
  }

  async process(job: GenerationJob): Promise<ProcessedLocalRepair> {
    if (job.operation !== "repair" || job.status !== "repairing" || !job.sourceAssetId || !job.sourceAnalysisId) {
      throw new LocalLoopRepairError(`Job ${job.id} is not ready for exact-lineage local loop repair.`, false);
    }
    if (job.outputAssetId) {
      return { assetId: job.outputAssetId, materializationLatencyMs: job.downloadLatencyMs ?? 0 };
    }
    const attempt = await this.requireAttempt(job);
    const source = await this.repository.getRepairSource(job.id);
    if (
      !source ||
      source.assetId !== job.sourceAssetId ||
      source.sourceAnalysisId !== job.sourceAnalysisId ||
      source.storageBucket !== "project-assets"
    ) {
      throw new LocalLoopRepairError(`Job ${job.id} no longer has a valid current immutable repair source.`, false);
    }

    const startedAt = this.now();
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = await this.objectStore.download(source.storagePath);
    } catch (error) {
      throw repairError("Unable to read immutable repair source", error, true);
    }

    let repaired: LoopRepairResult;
    let probe: MediaProbe;
    try {
      repaired = await this.repair(sourceBytes, source.filename, source.durationSeconds, source.hasAlpha);
      probe = await this.probe(repaired.bytes, "loop-doctor-output.mp4", "video");
      assertRepairedProbe(source.durationSeconds, source.frameRate, probe);
    } catch (error) {
      throw repairError("Unable to create a valid local loop repair", error, false);
    }

    const registrar = new GeneratedOutputRegistrar(this.repository, this.objectStore);
    let output;
    try {
      output = await registrar.materialize(job, attempt, repaired.bytes, probe);
    } catch (error) {
      throw repairError("Unable to store local loop repair", error, true);
    }
    const materializationLatencyMs = Math.max(0, Math.round(this.now() - startedAt));
    try {
      await this.repository.updateAttempt(attempt.providerJobId as string, {
        status: "completed",
        costUsd: 0,
        result: { previewUrl: `storage://${output.storageBucket}/${output.storagePath}` },
        latencyMs: materializationLatencyMs,
        rawResponse: {
          localTransform: repaired.policy,
          sourceAssetId: source.assetId,
          sourceAnalysisId: source.sourceAnalysisId,
          outputContentSha256: output.contentSha256
        },
        errorCategory: undefined,
        errorMessage: undefined,
        finishedAt: new Date(this.now()).toISOString()
      });
      const registered = await registrar.register(job, attempt, output, materializationLatencyMs);
      return { assetId: registered.assetId, materializationLatencyMs };
    } catch (error) {
      throw repairError("Unable to register local loop repair", error, true);
    }
  }

  private async requireAttempt(job: GenerationJob): Promise<JobAttempt & { providerJobId: string }> {
    const attempt = await this.repository.getLatestAttempt(job.id);
    if (
      !attempt ||
      attempt.provider !== LOCAL_LOOP_REPAIR_PROVIDER ||
      attempt.providerModel !== LOCAL_LOOP_REPAIR_MODEL ||
      !attempt.providerJobId ||
      (attempt.status !== "running" && attempt.status !== "completed")
    ) {
      throw new LocalLoopRepairError(`Job ${job.id} has no resumable local loop repair attempt.`, false);
    }
    return attempt as JobAttempt & { providerJobId: string };
  }
}

function assertRepairedProbe(sourceDuration: number, sourceFrameRate: number, probe: MediaProbe): void {
  if (
    probe.kind !== "video" ||
    probe.durationSeconds === null ||
    probe.frameRate === null ||
    probe.width === null ||
    probe.height === null
  ) {
    throw new LocalLoopRepairError("Loop repair output is missing required video metadata.", false);
  }
  const durationTolerance = Math.max(0.05, 2 / sourceFrameRate);
  if (Math.abs(probe.durationSeconds - sourceDuration) > durationTolerance) {
    throw new LocalLoopRepairError(
      `Loop repair changed duration from ${sourceDuration}s to ${probe.durationSeconds}s beyond ${durationTolerance}s tolerance.`,
      false
    );
  }
  if (probe.hasAlpha) {
    throw new LocalLoopRepairError("The v1 local repair output unexpectedly contains alpha.", false);
  }
}

function repairError(prefix: string, error: unknown, retryable: boolean): LocalLoopRepairError {
  if (error instanceof LocalLoopRepairError) return error;
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return new LocalLoopRepairError(
    `${prefix}: ${message}`,
    error instanceof OutputRegistrationError ? error.retryable : retryable
  );
}
