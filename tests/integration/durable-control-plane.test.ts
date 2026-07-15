import {
  DurableJobController,
  JobConflictError,
  ProviderError,
  assertReserveJobTopology,
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
import {
  generationJobSchema,
  jobAttemptSchema,
  jobTimelineEventSchema,
  providerJobSnapshotSchema,
  providerSubmissionSchema
} from "@droploop/schemas";
import type {
  DurableJobStatus,
  GenerationJob,
  JobAttempt,
  JobTimelineActorType,
  JobTimelineEvent,
  JobTimelineEventType,
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

    await expect(controller.enqueue({ ...input, orchestrationMode: "split" })).rejects.toThrow(
      "different workflow topology"
    );
  });

  it("keeps dependent pipeline work blocked while split work remains claimable", async () => {
    const repository = new MemoryJobRepository();
    const workflowId = "workflow-1";
    const first = await repository.reserveJob({
      ...jobInput(),
      workflowId,
      orchestrationMode: "pipeline",
      idempotencyKey: "pipeline:first"
    });
    const second = await repository.reserveJob({
      ...jobInput(),
      workflowId,
      orchestrationMode: "pipeline",
      dependsOnJobIds: [first.job.id],
      idempotencyKey: "pipeline:second"
    });
    const split = await repository.reserveJob({
      ...jobInput(),
      workflowId: "workflow-split",
      orchestrationMode: "split",
      idempotencyKey: "split:one"
    });

    const claimedFirst = await repository.claimNextJob("worker-1", 60);
    expect(claimedFirst?.id).toBe(first.job.id);

    const claimedSplit = await repository.claimNextJob("worker-2", 60);
    expect(claimedSplit?.id).toBe(split.job.id);
    expect(claimedSplit?.id).not.toBe(second.job.id);

    await repository.updateJob(first.job.id, ["queued"], { status: "completed" });
    const claimedSecond = await repository.claimNextJob("worker-3", 60);
    expect(claimedSecond?.id).toBe(second.job.id);
  });

  it("rejects dependency declarations outside a shared pipeline workflow", () => {
    expect(() =>
      assertReserveJobTopology({
        ...jobInput(),
        orchestrationMode: "split",
        dependsOnJobIds: ["job-1"]
      })
    ).toThrow("split jobs cannot declare dependencies");

    expect(() =>
      assertReserveJobTopology({
        ...jobInput(),
        orchestrationMode: "pipeline",
        dependsOnJobIds: ["job-1"]
      })
    ).toThrow("must declare their shared workflow ID");
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

    const timeline = await controller.listTimeline(job.id);
    expect(timeline.map((event) => event.eventType)).toEqual([
      "job_reserved",
      "status_changed",
      "attempt_started",
      "status_changed",
      "attempt_updated",
      "status_changed"
    ]);
    expect(timeline.at(-1)).toMatchObject({
      fromStatus: "provider_running",
      toStatus: "downloading"
    });
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
  readonly dependencies = new Map<string, Set<string>>();
  readonly timeline: JobTimelineEvent[] = [];
  private jobSequence = 0;
  private attemptSequence = 0;
  private eventSequence = 0;

  async reserveJob(input: ReserveJobInput): Promise<{ job: GenerationJob; created: boolean }> {
    assertReserveJobTopology(input);
    const existing = Array.from(this.jobs.values()).find(
      (job) => job.projectId === input.projectId && job.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      const existingDependencies = Array.from(this.dependencies.get(existing.id) ?? []).sort();
      const requestedDependencies = [...(input.dependsOnJobIds ?? [])].sort();
      if (
        existing.operation !== input.operation ||
        existing.orchestrationMode !== (input.orchestrationMode ?? "solo") ||
        (input.workflowId !== undefined && existing.workflowId !== input.workflowId) ||
        existingDependencies.length !== requestedDependencies.length ||
        existingDependencies.some((dependencyId, index) => dependencyId !== requestedDependencies[index])
      ) {
        throw new JobConflictError(
          `Idempotency key ${input.idempotencyKey} is already reserved with a different workflow topology.`
        );
      }
      return { job: existing, created: false };
    }

    this.jobSequence += 1;
    const jobId = `job-${this.jobSequence}`;
    const job = generationJobSchema.parse({
      id: jobId,
      projectId: input.projectId,
      workflowId: input.workflowId ?? `workflow-${this.jobSequence}`,
      orchestrationMode: input.orchestrationMode ?? "solo",
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
    this.dependencies.set(job.id, new Set(input.dependsOnJobIds ?? []));
    this.appendTimeline(job.id, "job_reserved", "system", {
      toStatus: "queued",
      payload: {
        workflowId: job.workflowId,
        orchestrationMode: job.orchestrationMode,
        operation: job.operation
      }
    });
    for (const dependencyId of input.dependsOnJobIds ?? []) {
      this.appendTimeline(job.id, "dependency_added", "system", {
        payload: { dependsOnJobId: dependencyId }
      });
    }
    return { job, created: true };
  }

  async getJob(jobId: string): Promise<GenerationJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async claimNextJob(workerId: string, leaseSeconds: number): Promise<GenerationJob | null> {
    const job = Array.from(this.jobs.values()).find((candidate) => {
      if (["completed", "failed", "cancelled"].includes(candidate.status) || candidate.leasedBy) {
        return false;
      }
      return Array.from(this.dependencies.get(candidate.id) ?? []).every(
        (dependencyId) => this.jobs.get(dependencyId)?.status === "completed"
      );
    });
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
    if (current.status !== parsed.status) {
      this.appendTimeline(jobId, "status_changed", parsed.leasedBy ? "worker" : "system", {
        actorId: parsed.leasedBy,
        fromStatus: current.status,
        toStatus: parsed.status,
        payload: { progress: parsed.progress, attemptCount: parsed.attemptCount }
      });
    } else if (current.progress !== parsed.progress) {
      this.appendTimeline(jobId, "progress_changed", parsed.leasedBy ? "worker" : "system", {
        actorId: parsed.leasedBy,
        payload: { from: current.progress, to: parsed.progress, status: parsed.status }
      });
    }
    if (current.leasedBy !== parsed.leasedBy) {
      this.appendTimeline(jobId, parsed.leasedBy ? "lease_claimed" : "lease_released", "worker", {
        actorId: parsed.leasedBy ?? current.leasedBy,
        payload: parsed.leasedBy ? { expiresAt: parsed.leaseExpiresAt } : {}
      });
    }
    return parsed;
  }

  async createAttempt(input: CreateAttemptInput): Promise<JobAttempt> {
    this.attemptSequence += 1;
    const attempt = jobAttemptSchema.parse({ id: `attempt-${this.attemptSequence}`, ...input });
    this.attempts.push(attempt);
    this.appendTimeline(attempt.jobId, "attempt_started", "provider", {
      actorId: attempt.provider,
      payload: {
        attemptNumber: attempt.attemptNumber,
        provider: attempt.provider,
        providerJobId: attempt.providerJobId,
        status: attempt.status
      }
    });
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
    this.appendTimeline(updated.jobId, "attempt_updated", "provider", {
      actorId: updated.provider,
      payload: {
        attemptNumber: updated.attemptNumber,
        providerJobId: updated.providerJobId,
        status: updated.status,
        costUsd: updated.costUsd
      }
    });
    return updated;
  }

  async listJobTimeline(jobId: string, afterSequence = 0, limit = 100): Promise<JobTimelineEvent[]> {
    return this.timeline
      .filter((event) => event.jobId === jobId && event.sequence > afterSequence)
      .slice(0, Math.min(Math.max(limit, 1), 200));
  }

  private appendTimeline(
    jobId: string,
    eventType: JobTimelineEventType,
    actorType: JobTimelineActorType,
    detail: {
      actorId?: string;
      fromStatus?: DurableJobStatus;
      toStatus?: DurableJobStatus;
      payload: Record<string, unknown>;
    }
  ): void {
    this.eventSequence += 1;
    this.timeline.push(
      jobTimelineEventSchema.parse({
        id: `event-${this.eventSequence}`,
        sequence: this.eventSequence,
        jobId,
        eventType,
        actorType,
        ...(detail.actorId ? { actorId: detail.actorId } : {}),
        ...(detail.fromStatus ? { fromStatus: detail.fromStatus } : {}),
        ...(detail.toStatus ? { toStatus: detail.toStatus } : {}),
        payload: detail.payload,
        createdAt: now().toISOString()
      })
    );
  }
}
