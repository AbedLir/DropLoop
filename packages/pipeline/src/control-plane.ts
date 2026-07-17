import {
  generationJobSchema,
  jobAttemptSchema,
  providerJobSnapshotSchema,
  providerSubmissionSchema
} from "@droploop/schemas";
import { LOOP_ANALYSIS_POLICY_V1 } from "@droploop/media";
import type { LoopAnalysisResult, MediaProbe } from "@droploop/media";
import type {
  ClipPrompt,
  DurableJobStatus,
  GenerationJob,
  JobAttempt,
  JobErrorCategory,
  JobOperation,
  JobTimelineEvent,
  OrchestrationMode,
  ProviderJobSnapshot,
  ProviderSubmission
} from "@droploop/schemas";

export type GenerateVideoInput = {
  projectId: string;
  idempotencyKey: string;
  prompt: ClipPrompt;
};

export type RepairVideoInput = {
  projectId: string;
  idempotencyKey: string;
  plannedClipId: string;
  sourceAssetId: string;
  sourceAnalysisId: string;
  repairInstruction: string;
};

export interface VideoProvider {
  readonly name: string;
  readonly model?: string;
  submitGeneration(input: GenerateVideoInput): Promise<ProviderSubmission>;
  submitRepair(input: RepairVideoInput): Promise<ProviderSubmission>;
  getJob(providerJobId: string): Promise<ProviderJobSnapshot>;
  cancelJob(providerJobId: string): Promise<void>;
}

export type ReserveJobInput = {
  projectId: string;
  workflowId?: string;
  orchestrationMode?: OrchestrationMode;
  dependsOnJobIds?: string[];
  operation: JobOperation;
  idempotencyKey: string;
  input: Record<string, unknown>;
  sourceAssetId?: string;
  sourceAnalysisId?: string;
  maxAttempts?: number;
};

export type JobChanges = {
  status?: DurableJobStatus;
  progress?: number;
  provider?: string | null;
  providerJobId?: string | null;
  providerModel?: string | null;
  providerConfig?: Record<string, unknown> | null;
  attemptCount?: number;
  costUsd?: number;
  outputAssetId?: string | null;
  providerLatencyMs?: number | null;
  downloadLatencyMs?: number | null;
  errorCategory?: JobErrorCategory | null;
  errorMessage?: string | null;
  leasedBy?: string | null;
  leaseExpiresAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
};

export type CreateAttemptInput = Omit<JobAttempt, "id">;

export type RegisterProviderOutputInput = {
  assetId: string;
  jobId: string;
  attemptId: string;
  ownerId: string;
  storageBucket: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  downloadLatencyMs: number;
  probe: MediaProbe;
};

export type RegisteredProviderOutput = {
  assetId: string;
  projectId: string;
  jobId: string;
  attemptId: string;
  storageBucket: string;
  storagePath: string;
  previewUrl: string;
};

export type ValidationAsset = {
  assetId: string;
  jobId: string;
  projectId: string;
  storageBucket: string;
  storagePath: string;
  filename: string;
  durationSeconds: number;
  frameRate: number;
};

export type RegisterLoopAnalysisInput = {
  analysisId: string;
  jobId: string;
  assetId: string;
  result: LoopAnalysisResult;
};

export type StoredLoopAnalysis = RegisterLoopAnalysisInput & {
  sourceAnalysisId?: string;
  createdAt: string;
};

export interface DurableJobRepository {
  reserveJob(input: ReserveJobInput): Promise<{ job: GenerationJob; created: boolean }>;
  getJob(jobId: string): Promise<GenerationJob | null>;
  claimNextJob(workerId: string, leaseSeconds: number): Promise<GenerationJob | null>;
  releaseLease(jobId: string, workerId: string): Promise<boolean>;
  updateJob(jobId: string, expectedStatuses: DurableJobStatus[], changes: JobChanges): Promise<GenerationJob>;
  createAttempt(input: CreateAttemptInput): Promise<JobAttempt>;
  updateAttempt(providerJobId: string, changes: Partial<JobAttempt>): Promise<JobAttempt>;
  getLatestAttempt(jobId: string): Promise<JobAttempt | null>;
  getProjectOwnerId(projectId: string): Promise<string | null>;
  registerProviderOutput(input: RegisterProviderOutputInput): Promise<RegisteredProviderOutput>;
  getValidationAsset(jobId: string): Promise<ValidationAsset | null>;
  registerLoopAnalysis(input: RegisterLoopAnalysisInput): Promise<StoredLoopAnalysis>;
  getLatestLoopAnalysis(jobId: string): Promise<StoredLoopAnalysis | null>;
  listJobTimeline(jobId: string, afterSequence?: number, limit?: number): Promise<JobTimelineEvent[]>;
}

export class InvalidJobTransitionError extends Error {
  constructor(from: DurableJobStatus, to: DurableJobStatus) {
    super(`Invalid durable job transition: ${from} -> ${to}`);
    this.name = "InvalidJobTransitionError";
  }
}

export class JobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobConflictError";
  }
}

export class ProviderError extends Error {
  readonly category: JobErrorCategory;

  constructor(category: JobErrorCategory, message: string) {
    super(message);
    this.name = "ProviderError";
    this.category = category;
  }
}

const transitions: Record<DurableJobStatus, readonly DurableJobStatus[]> = {
  queued: ["submitting", "cancelled"],
  submitting: ["provider_running", "downloading", "queued", "failed", "cancelled"],
  provider_running: ["downloading", "queued", "failed", "cancelled"],
  downloading: ["validating", "queued", "failed", "cancelled"],
  validating: ["awaiting_review", "repairing", "failed", "cancelled"],
  awaiting_review: ["repairing", "exporting", "cancelled"],
  repairing: ["submitting", "provider_running", "downloading", "validating", "queued", "failed", "cancelled"],
  exporting: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: []
};

export function canTransitionJob(from: DurableJobStatus, to: DurableJobStatus): boolean {
  return transitions[from].includes(to);
}

export function assertJobTransition(from: DurableJobStatus, to: DurableJobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}

export class DurableJobController {
  constructor(
    private readonly repository: DurableJobRepository,
    private readonly provider: VideoProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  enqueue(input: ReserveJobInput): Promise<{ job: GenerationJob; created: boolean }> {
    assertReserveJobTopology(input);
    return this.repository.reserveJob(input);
  }

  listTimeline(jobId: string, afterSequence = 0, limit = 100): Promise<JobTimelineEvent[]> {
    return this.repository.listJobTimeline(jobId, afterSequence, limit);
  }

  async submitGeneration(jobId: string, input: GenerateVideoInput): Promise<GenerationJob> {
    return this.submit(jobId, () => this.provider.submitGeneration(input));
  }

  async submitRepair(jobId: string, input: RepairVideoInput): Promise<GenerationJob> {
    return this.submit(jobId, () => this.provider.submitRepair(input));
  }

  async refresh(jobId: string): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);

    if (!job.providerJobId) {
      throw new JobConflictError(`Job ${job.id} has no provider job ID to refresh.`);
    }

    if (job.status !== "provider_running") {
      throw new JobConflictError(`Job ${job.id} cannot be refreshed from ${job.status}.`);
    }

    const attempt = await this.repository.getLatestAttempt(job.id);
    if (!attempt || attempt.providerJobId !== job.providerJobId) {
      throw new JobConflictError(`Job ${job.id} has no matching provider attempt to refresh.`);
    }

    const snapshot = providerJobSnapshotSchema.parse(await this.provider.getJob(job.providerJobId));
    const latencyMs = calculateLatencyMs(attempt.startedAt, snapshot.updatedAt);
    const completedWithoutResult = snapshot.status === "completed" && !snapshot.result;
    await this.repository.updateAttempt(snapshot.providerJobId, {
      status: completedWithoutResult ? "failed" : snapshot.status,
      costUsd: snapshot.costUsd ?? job.costUsd,
      ...(snapshot.result === undefined ? {} : { result: snapshot.result }),
      latencyMs,
      ...(snapshot.rawResponse === undefined ? {} : { rawResponse: snapshot.rawResponse }),
      ...(completedWithoutResult
        ? { errorCategory: "provider_rejected", errorMessage: "Provider completed without a downloadable result." }
        : snapshot.errorCategory === undefined
          ? {}
          : { errorCategory: snapshot.errorCategory }),
      ...(completedWithoutResult
        ? {}
        : snapshot.errorMessage === undefined
          ? {}
          : { errorMessage: snapshot.errorMessage }),
      ...(["completed", "failed", "cancelled"].includes(snapshot.status) ? { finishedAt: snapshot.updatedAt } : {})
    });

    if (completedWithoutResult) {
      return this.failOrRetry(job, "provider_rejected", "Provider completed without a downloadable result.");
    }

    if (snapshot.status === "queued" || snapshot.status === "running") {
      return this.repository.updateJob(job.id, ["provider_running"], {
        progress: snapshot.progress,
        costUsd: snapshot.costUsd ?? job.costUsd,
        providerLatencyMs: latencyMs
      });
    }

    if (snapshot.status === "completed") {
      return this.transition(job, "downloading", {
        progress: Math.max(70, snapshot.progress),
        costUsd: snapshot.costUsd ?? job.costUsd,
        providerLatencyMs: latencyMs,
        errorCategory: null,
        errorMessage: null
      });
    }

    if (snapshot.status === "cancelled") {
      return this.transition(job, "cancelled", {
        progress: snapshot.progress,
        costUsd: snapshot.costUsd ?? job.costUsd,
        providerLatencyMs: latencyMs,
        errorCategory: "cancelled",
        errorMessage: snapshot.errorMessage ?? "Provider job was cancelled.",
        cancelledAt: snapshot.updatedAt
      });
    }

    return this.failOrRetry(job, snapshot.errorCategory ?? "provider_rejected", snapshot.errorMessage ?? "Provider job failed.");
  }

  async cancel(jobId: string): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);

    if (["completed", "failed", "cancelled"].includes(job.status)) {
      throw new JobConflictError(`Job ${job.id} is already terminal (${job.status}).`);
    }

    if (job.providerJobId) {
      await this.provider.cancelJob(job.providerJobId);
    }

    return this.transition(job, "cancelled", {
      errorCategory: "cancelled",
      errorMessage: "Cancelled by user.",
      cancelledAt: this.now().toISOString()
    });
  }

  async recoverInterruptedSubmission(jobId: string): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "submitting") {
      throw new JobConflictError(`Job ${job.id} cannot recover a submission from ${job.status}.`);
    }
    return this.transition(job, "queued", {
      progress: 0,
      errorCategory: "internal",
      errorMessage: "Recovered after a worker lease expired during provider submission."
    });
  }

  async completeDownload(jobId: string, assetId: string, downloadLatencyMs?: number): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "downloading") {
      throw new JobConflictError(`Job ${job.id} cannot complete a download from ${job.status}.`);
    }
    return this.transition(job, "validating", {
      progress: 85,
      outputAssetId: assetId,
      ...(downloadLatencyMs === undefined ? {} : { downloadLatencyMs }),
      errorCategory: null,
      errorMessage: null
    });
  }

  async completeValidation(jobId: string): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "validating") {
      throw new JobConflictError(`Job ${job.id} cannot complete validation from ${job.status}.`);
    }
    if (!job.outputAssetId) {
      throw new JobConflictError(`Job ${job.id} has no immutable output asset to validate.`);
    }
    const analysis = await this.repository.getLatestLoopAnalysis(job.id);
    if (
      !analysis ||
      analysis.assetId !== job.outputAssetId ||
      analysis.result.algorithmVersion !== LOOP_ANALYSIS_POLICY_V1.algorithmVersion
    ) {
      throw new JobConflictError(`Job ${job.id} has no current persisted loop analysis for its immutable output asset.`);
    }
    return this.transition(job, "awaiting_review", {
      progress: 100,
      errorCategory: null,
      errorMessage: null
    });
  }

  async recordValidationFailure(jobId: string, message: string, retryable: boolean): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "validating") {
      throw new JobConflictError(`Job ${job.id} cannot record a validation failure from ${job.status}.`);
    }
    if (retryable) {
      return this.repository.updateJob(job.id, ["validating"], {
        errorCategory: "validation_failed",
        errorMessage: message
      });
    }
    return this.transition(job, "failed", {
      errorCategory: "validation_failed",
      errorMessage: message
    });
  }

  async recordDownloadFailure(jobId: string, message: string, retryable: boolean): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "downloading") {
      throw new JobConflictError(`Job ${job.id} cannot record a download failure from ${job.status}.`);
    }
    if (retryable) {
      return this.repository.updateJob(job.id, ["downloading"], {
        errorCategory: "download_failed",
        errorMessage: message
      });
    }
    return this.transition(job, "failed", {
      errorCategory: "download_failed",
      errorMessage: message
    });
  }

  private async submit(jobId: string, submit: () => Promise<ProviderSubmission>): Promise<GenerationJob> {
    const queuedJob = await this.requireJob(jobId);

    if (queuedJob.status !== "queued" && queuedJob.status !== "repairing") {
      throw new JobConflictError(`Job ${queuedJob.id} cannot be submitted from ${queuedJob.status}.`);
    }

    const submitting = await this.transition(queuedJob, "submitting", {
      provider: this.provider.name,
      ...(this.provider.model ? { providerModel: this.provider.model } : {}),
      progress: 5,
      startedAt: queuedJob.startedAt ?? this.now().toISOString(),
      errorCategory: null,
      errorMessage: null
    });
    const attemptNumber = submitting.attemptCount + 1;
    const attempting = await this.repository.updateJob(submitting.id, ["submitting"], {
      attemptCount: attemptNumber
    });

    let submission: ProviderSubmission;
    try {
      submission = providerSubmissionSchema.parse(await submit());
    } catch (error) {
      const category = error instanceof ProviderError ? error.category : "internal";
      const message = error instanceof Error ? error.message : "Unknown provider submission error.";
      const failedAt = this.now().toISOString();
      await this.repository.createAttempt({
        jobId: attempting.id,
        attemptNumber,
        provider: this.provider.name,
        ...(this.provider.model ? { providerModel: this.provider.model } : {}),
        status: "failed",
        costUsd: 0,
        errorCategory: category,
        errorMessage: message,
        startedAt: failedAt,
        finishedAt: failedAt
      });
      return this.failOrRetry(attempting, category, message);
    }

    await this.repository.createAttempt(
      jobAttemptSchema
        .omit({ id: true })
        .parse({
          jobId: attempting.id,
          attemptNumber,
          provider: this.provider.name,
          providerModel: this.provider.model,
          providerJobId: submission.providerJobId,
          status: submission.status,
          costUsd: 0,
          rawResponse: submission.rawResponse,
          startedAt: submission.submittedAt,
          finishedAt: ["completed", "failed", "cancelled"].includes(submission.status) ? submission.submittedAt : undefined
        })
    );

    if (submission.status === "failed") {
      return this.failOrRetry(attempting, "provider_rejected", "Provider rejected the submission.");
    }

    if (submission.status === "cancelled") {
      return this.transition(attempting, "cancelled", {
        errorCategory: "cancelled",
        errorMessage: "Provider cancelled the submission.",
        cancelledAt: submission.submittedAt
      });
    }

    return this.transition(attempting, "provider_running", {
      providerJobId: submission.providerJobId,
      progress: submission.status === "completed" ? 70 : 10
    });
  }

  private async failOrRetry(job: GenerationJob, category: JobErrorCategory, message: string): Promise<GenerationJob> {
    const shouldRetry = job.attemptCount < job.maxAttempts;
    return this.transition(job, shouldRetry ? "queued" : "failed", {
      progress: shouldRetry ? 0 : job.progress,
      errorCategory: category,
      errorMessage: message
    });
  }

  private async transition(job: GenerationJob, status: DurableJobStatus, changes: JobChanges): Promise<GenerationJob> {
    assertJobTransition(job.status, status);
    return generationJobSchema.parse(
      await this.repository.updateJob(job.id, [job.status], {
        ...changes,
        status
      })
    );
  }

  private async requireJob(jobId: string): Promise<GenerationJob> {
    const job = await this.repository.getJob(jobId);
    if (!job) {
      throw new JobConflictError(`Job ${jobId} does not exist.`);
    }
    return generationJobSchema.parse(job);
  }
}

function calculateLatencyMs(startedAt: string, finishedAt: string): number {
  const elapsed = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
}

export function assertReserveJobTopology(input: ReserveJobInput): void {
  const mode = input.orchestrationMode ?? "solo";
  const dependencies = input.dependsOnJobIds ?? [];
  const uniqueDependencies = new Set(dependencies);

  if ((input.sourceAssetId === undefined) !== (input.sourceAnalysisId === undefined)) {
    throw new JobConflictError("Repair source asset and analysis IDs must be provided together.");
  }
  if (input.operation !== "repair" && input.sourceAssetId !== undefined) {
    throw new JobConflictError("Only repair jobs may bind source asset lineage.");
  }
  if (input.operation === "repair" && input.sourceAssetId === undefined) {
    throw new JobConflictError("Repair jobs require exact source asset and analysis IDs.");
  }

  if (uniqueDependencies.size !== dependencies.length) {
    throw new JobConflictError("A job cannot declare the same dependency more than once.");
  }

  if (dependencies.length > 0 && mode !== "pipeline") {
    throw new JobConflictError(`${mode} jobs cannot declare dependencies; use pipeline orchestration.`);
  }

  if (dependencies.length > 0 && !input.workflowId) {
    throw new JobConflictError("Pipeline jobs with dependencies must declare their shared workflow ID.");
  }
}
