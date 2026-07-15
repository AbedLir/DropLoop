import {
  DurableJobController,
  JobConflictError,
  ProviderError,
  canTransitionJob
} from "@droploop/pipeline";
import type {
  CreateAttemptInput,
  DurableJobRepository,
  GenerateVideoInput,
  JobChanges,
  RepairVideoInput,
  ReserveJobInput,
  VideoProvider
} from "@droploop/pipeline";
import { generationJobSchema, jobAttemptSchema, providerJobSnapshotSchema, providerSubmissionSchema } from "@droploop/schemas";
import type {
  DurableJobStatus,
  GenerationJob,
  JobAttempt,
  ProviderJobSnapshot,
  ProviderSubmission
} from "@droploop/schemas";
import { describe, expect, it } from "vitest";

const now = () => new Date("2026-07-15T00:00:00.000Z");

const prompt = {
  clipId: "drop-1",
  role: "drop" as const,
  durationSeconds: 8,
  energy: 90,
  positivePrompt: "chrome tunnel pulse",
  negativePrompt: "text, faces, logos",
  loopRequirements: "matching boundary frames",
  stageRequirements: "LED-readable contrast",
  qualityTargets: {}
};

describe("durable control plane", () => {
  it("allows only explicit state transitions", () => {
    expect(canTransitionJob("queued", "submitting")).toBe(true);
    expect(canTransitionJob("provider_running", "downloading")).toBe(true);
    expect(canTransitionJob("completed", "queued")).toBe(false);
    expect(canTransitionJob("awaiting_review", "completed")).toBe(false);
  });

  it("reserves one job for repeated idempotency keys", async () => {
    const repository = new MemoryJobRepository();
    const controller = new DurableJobController(repository, new FakeProvider(), now);
    const input = jobInput();

    const first = await controller.enqueue(input);
    const duplicate = await controller.enqueue(input);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.job.id).toBe(first.job.id);
    expect(repository.jobs.size).toBe(1);
  });

  it("submits and polls through the same provider-backed state machine", async () => {
    const repository = new MemoryJobRepository();
    const provider = new FakeProvider();
    const controller = new DurableJobController(repository, provider, now);
    const { job } = await controller.enqueue(jobInput());

    const running = await controller.submitGeneration(job.id, {
      projectId: job.projectId,
      idempotencyKey: job.idempotencyKey,
      prompt
    });

    expect(running.status).toBe("provider_running");
    expect(running.provider).toBe("fake-provider");
    expect(running.providerJobId).toBe("provider-job-1");
    expect(running.attemptCount).toBe(1);
    expect(repository.attempts).toHaveLength(1);

    const downloading = await controller.refresh(job.id);
    expect(downloading.status).toBe("downloading");
    expect(downloading.progress).toBe(100);
    expect(downloading.costUsd).toBe(0.42);
    expect(repository.attempts[0]?.status).toBe("completed");
  });

  it("records failed attempts and stops retrying at the configured limit", async () => {
    const repository = new MemoryJobRepository();
    const provider = new FakeProvider(2);
    const controller = new DurableJobController(repository, provider, now);
    const { job } = await controller.enqueue({ ...jobInput(), maxAttempts: 2 });
    const input: GenerateVideoInput = {
      projectId: job.projectId,
      idempotencyKey: job.idempotencyKey,
      prompt
    };

    const retryable = await controller.submitGeneration(job.id, input);
    expect(retryable.status).toBe("queued");
    expect(retryable.attemptCount).toBe(1);
    expect(retryable.errorCategory).toBe("provider_rate_limited");

    const terminal = await controller.submitGeneration(job.id, input);
    expect(terminal.status).toBe("failed");
    expect(terminal.attemptCount).toBe(2);
    expect(repository.attempts.map((attempt) => attempt.status)).toEqual(["failed", "failed"]);
  });
});

function jobInput(): ReserveJobInput {
  return {
    projectId: "project-1",
    operation: "generate",
    idempotencyKey: "project-1:drop-1:v1",
    input: { prompt },
    maxAttempts: 3
  };
}

class FakeProvider implements VideoProvider {
  readonly name = "fake-provider";
  readonly model = "fake-v1";
  private submissions = 0;

  constructor(private failuresRemaining = 0) {}

  async submitGeneration(_input: GenerateVideoInput): Promise<ProviderSubmission> {
    return this.submit();
  }

  async submitRepair(_input: RepairVideoInput): Promise<ProviderSubmission> {
    return this.submit();
  }

  async getJob(providerJobId: string): Promise<ProviderJobSnapshot> {
    return providerJobSnapshotSchema.parse({
      providerJobId,
      status: "completed",
      progress: 100,
      costUsd: 0.42,
      result: { previewUrl: "/provider/result.mp4" },
      rawResponse: { requestId: "redacted" },
      updatedAt: now().toISOString()
    });
  }

  async cancelJob(_providerJobId: string): Promise<void> {}

  private async submit(): Promise<ProviderSubmission> {
    this.submissions += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new ProviderError("provider_rate_limited", "Provider rate limit.");
    }

    return providerSubmissionSchema.parse({
      providerJobId: `provider-job-${this.submissions}`,
      status: "queued",
      submittedAt: now().toISOString()
    });
  }
}

class MemoryJobRepository implements DurableJobRepository {
  readonly jobs = new Map<string, GenerationJob>();
  readonly attempts: JobAttempt[] = [];
  private jobSequence = 0;
  private attemptSequence = 0;

  async reserveJob(input: ReserveJobInput): Promise<{ job: GenerationJob; created: boolean }> {
    const existing = Array.from(this.jobs.values()).find(
      (job) => job.projectId === input.projectId && job.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      return { job: existing, created: false };
    }

    this.jobSequence += 1;
    const job = generationJobSchema.parse({
      id: `job-${this.jobSequence}`,
      projectId: input.projectId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      progress: 0,
      input: input.input,
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 3,
      costUsd: 0,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    });
    this.jobs.set(job.id, job);
    return { job, created: true };
  }

  async getJob(jobId: string): Promise<GenerationJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async claimNextJob(workerId: string, leaseSeconds: number): Promise<GenerationJob | null> {
    const job = Array.from(this.jobs.values()).find((candidate) => !["completed", "failed", "cancelled"].includes(candidate.status));
    if (!job) {
      return null;
    }
    return this.updateJob(job.id, [job.status], {
      leasedBy: workerId,
      leaseExpiresAt: new Date(now().getTime() + leaseSeconds * 1000).toISOString()
    });
  }

  async releaseLease(jobId: string, workerId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.leasedBy !== workerId) {
      return false;
    }
    await this.updateJob(jobId, [job.status], { leasedBy: null, leaseExpiresAt: null });
    return true;
  }

  async updateJob(jobId: string, expectedStatuses: DurableJobStatus[], changes: JobChanges): Promise<GenerationJob> {
    const current = this.jobs.get(jobId);
    if (!current || !expectedStatuses.includes(current.status)) {
      throw new JobConflictError(`Optimistic update failed for ${jobId}.`);
    }

    const next = { ...current } as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    next.updatedAt = now().toISOString();
    const parsed = generationJobSchema.parse(next);
    this.jobs.set(jobId, parsed);
    return parsed;
  }

  async createAttempt(input: CreateAttemptInput): Promise<JobAttempt> {
    this.attemptSequence += 1;
    const attempt = jobAttemptSchema.parse({ id: `attempt-${this.attemptSequence}`, ...input });
    this.attempts.push(attempt);
    return attempt;
  }

  async updateAttempt(providerJobId: string, changes: Partial<JobAttempt>): Promise<JobAttempt> {
    const index = this.attempts.findIndex((attempt) => attempt.providerJobId === providerJobId);
    if (index < 0) {
      throw new JobConflictError(`Missing attempt for ${providerJobId}.`);
    }
    const current = this.attempts[index];
    const updated = jobAttemptSchema.parse({ ...current, ...changes });
    this.attempts[index] = updated;
    return updated;
  }
}
