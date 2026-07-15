import {
  generationJobSchema,
  jobAttemptSchema,
  providerJobSnapshotSchema,
  providerSubmissionSchema
} from "@droploop/schemas";
import type {
  ClipPrompt,
  DurableJobStatus,
  GeneratedClip,
  GenerationJob,
  JobAttempt,
  JobErrorCategory,
  JobOperation,
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
  clip: GeneratedClip;
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
  operation: JobOperation;
  idempotencyKey: string;
  input: Record<string, unknown>;
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
  errorCategory?: JobErrorCategory | null;
  errorMessage?: string | null;
  leasedBy?: string | null;
  leaseExpiresAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
};

export type CreateAttemptInput = Omit<JobAttempt, "id">;

export interface DurableJobRepository {
  reserveJob(input: ReserveJobInput): Promise<{ job: GenerationJob; created: boolean }>;
  getJob(jobId: string): Promise<GenerationJob | null>;
  claimNextJob(workerId: string, leaseSeconds: number): Promise<GenerationJob | null>;
  releaseLease(jobId: string, workerId: string): Promise<boolean>;
  updateJob(jobId: string, expectedStatuses: DurableJobStatus[], changes: JobChanges): Promise<GenerationJob>;
  createAttempt(input: CreateAttemptInput): Promise<JobAttempt>;
  updateAttempt(providerJobId: string, changes: Partial<JobAttempt>): Promise<JobAttempt>;
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
    return this.repository.reserveJob(input);
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

    const snapshot = providerJobSnapshotSchema.parse(await this.provider.getJob(job.providerJobId));
    await this.repository.updateAttempt(snapshot.providerJobId, {
      status: snapshot.status,
      costUsd: snapshot.costUsd ?? job.costUsd,
      ...(snapshot.rawResponse === undefined ? {} : { rawResponse: snapshot.rawResponse }),
      ...(snapshot.errorCategory === undefined ? {} : { errorCategory: snapshot.errorCategory }),
      ...(snapshot.errorMessage === undefined ? {} : { errorMessage: snapshot.errorMessage }),
      ...(["completed", "failed", "cancelled"].includes(snapshot.status) ? { finishedAt: snapshot.updatedAt } : {})
    });

    if (snapshot.status === "queued" || snapshot.status === "running") {
      return this.repository.updateJob(job.id, ["provider_running"], {
        progress: snapshot.progress,
        costUsd: snapshot.costUsd ?? job.costUsd
      });
    }

    if (snapshot.status === "completed") {
      return this.transition(job, "downloading", {
        progress: Math.max(70, snapshot.progress),
        costUsd: snapshot.costUsd ?? job.costUsd,
        errorCategory: null,
        errorMessage: null
      });
    }

    if (snapshot.status === "cancelled") {
      return this.transition(job, "cancelled", {
        progress: snapshot.progress,
        costUsd: snapshot.costUsd ?? job.costUsd,
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

    const nextStatus = submission.status === "completed" ? "downloading" : "provider_running";
    return this.transition(attempting, nextStatus, {
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
