import { providerJobSnapshotSchema, providerSubmissionSchema } from "@droploop/schemas";
import type { ProviderJobSnapshot, ProviderSubmission } from "@droploop/schemas";
import type { GenerateVideoInput, RepairVideoInput, VideoProvider } from "./video-provider";

type MockJob = {
  id: string;
  clipId: string;
  status: "queued" | "cancelled";
  submittedAt: string;
};

export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";
  readonly model = "deterministic-contract-fixture";
  private readonly jobs = new Map<string, MockJob>();

  async submitGeneration(input: GenerateVideoInput): Promise<ProviderSubmission> {
    return this.submit(input.projectId, input.idempotencyKey, input.prompt.clipId);
  }

  async submitRepair(input: RepairVideoInput): Promise<ProviderSubmission> {
    return this.submit(input.projectId, input.idempotencyKey, `${input.plannedClipId}-repair`);
  }

  async getJob(providerJobId: string): Promise<ProviderJobSnapshot> {
    const job = this.jobs.get(providerJobId);
    if (!job) {
      throw new Error(`Unknown mock provider job ${providerJobId}.`);
    }

    if (job.status === "cancelled") {
      return providerJobSnapshotSchema.parse({
        providerJobId,
        status: "cancelled",
        progress: 0,
        errorCategory: "cancelled",
        errorMessage: "Mock provider job was cancelled.",
        updatedAt: new Date().toISOString()
      });
    }

    return providerJobSnapshotSchema.parse({
      providerJobId,
      status: "completed",
      progress: 100,
      costUsd: 0,
      result: {
        previewUrl: `/mock/clips/${job.clipId}.mp4`,
        thumbnailUrl: `/mock/thumbnails/${job.clipId}.jpg`
      },
      rawResponse: { fixture: true },
      updatedAt: new Date().toISOString()
    });
  }

  async cancelJob(providerJobId: string): Promise<void> {
    const job = this.jobs.get(providerJobId);
    if (!job) {
      throw new Error(`Unknown mock provider job ${providerJobId}.`);
    }
    job.status = "cancelled";
  }

  private async submit(projectId: string, idempotencyKey: string, clipId: string): Promise<ProviderSubmission> {
    const providerJobId = `mock:${projectId}:${idempotencyKey}`;
    const existing = this.jobs.get(providerJobId);
    const submittedAt = existing?.submittedAt ?? new Date().toISOString();

    this.jobs.set(providerJobId, {
      id: providerJobId,
      clipId,
      status: existing?.status ?? "queued",
      submittedAt
    });

    return providerSubmissionSchema.parse({
      providerJobId,
      status: "queued",
      submittedAt,
      rawResponse: { fixture: true }
    });
  }
}
