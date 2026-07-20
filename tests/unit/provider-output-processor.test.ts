import type { MediaProbe } from "@droploop/media";
import type { DurableJobRepository, RegisterProviderOutputInput } from "@droploop/pipeline";
import { generationJobSchema, jobAttemptSchema } from "@droploop/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  OutputProcessingError,
  ProviderOutputProcessor,
  type OutputObjectStore
} from "../../apps/worker/src/output/provider-output-processor";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444"
};

const job = generationJobSchema.parse({
  id: ids.job,
  projectId: ids.project,
  workflowId: "workflow-1",
  orchestrationMode: "solo",
  operation: "generate",
  idempotencyKey: "generate-1",
  status: "downloading",
  progress: 70,
  input: {},
  provider: "seedance",
  providerJobId: "provider-job-1",
  attemptCount: 1,
  maxAttempts: 3,
  costUsd: 0,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z"
});

const attempt = jobAttemptSchema.parse({
  id: ids.attempt,
  jobId: ids.job,
  attemptNumber: 1,
  provider: "seedance",
  providerJobId: "provider-job-1",
  status: "completed",
  costUsd: 0,
  result: { previewUrl: "https://provider.example/result.mp4" },
  startedAt: "2026-07-16T00:00:00.000Z",
  finishedAt: "2026-07-16T00:01:00.000Z"
});

const probe: MediaProbe = {
  kind: "video",
  durationSeconds: 8,
  width: 1920,
  height: 1080,
  frameRate: 30,
  codec: "h264",
  pixelFormat: "yuv420p",
  hasAlpha: false,
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
  audioCodec: null,
  videoCodec: "h264"
};

describe("provider output processor", () => {
  it("downloads, probes, stores, and registers an immutable provider result", async () => {
    const register = vi.fn(async (input: RegisterProviderOutputInput) => ({
      assetId: input.assetId,
      projectId: ids.project,
      jobId: ids.job,
      attemptId: ids.attempt,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      previewUrl: `/api/projects/${ids.project}/assets/${input.assetId}/content`
    }));
    const repository = repositoryWith(register);
    const store = new MemoryOutputStore();
    const clock = [1000, 1450];
    const processor = new ProviderOutputProcessor(repository, store, {
      fetch: async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
      probe: async () => probe,
      now: () => clock.shift() ?? 1450
    });

    const output = await processor.process(job);

    expect(output.downloadLatencyMs).toBe(450);
    expect(output.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0]?.path).toMatch(
      new RegExp(`^${ids.owner}/${ids.project}/outputs/${ids.job}/${ids.attempt}/[0-9a-f]{64}\\.mp4$`)
    );
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: ids.job,
        attemptId: ids.attempt,
        ownerId: ids.owner,
        storageBucket: "project-assets",
        sizeBytes: 4,
        downloadLatencyMs: 450,
        probe
      })
    );
  });

  it("fails closed when the completed provider result is not a valid video", async () => {
    const processor = new ProviderOutputProcessor(repositoryWith(), new MemoryOutputStore(), {
      fetch: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      probe: async () => {
        throw new Error("missing video stream");
      }
    });

    await expect(processor.process(job)).rejects.toMatchObject<Partial<OutputProcessingError>>({
      retryable: false,
      message: expect.stringContaining("not a valid video")
    });
  });

  it("marks transient provider download failures as retryable without uploading", async () => {
    const store = new MemoryOutputStore();
    const processor = new ProviderOutputProcessor(repositoryWith(), store, {
      fetch: async () => new Response("unavailable", { status: 503 })
    });

    await expect(processor.process(job)).rejects.toMatchObject<Partial<OutputProcessingError>>({
      retryable: true,
      message: expect.stringContaining("HTTP 503")
    });
    expect(store.uploads).toHaveLength(0);
  });
});

function repositoryWith(register = vi.fn(async (input: RegisterProviderOutputInput) => ({
  assetId: input.assetId,
  projectId: ids.project,
  jobId: ids.job,
  attemptId: ids.attempt,
  storageBucket: input.storageBucket,
  storagePath: input.storagePath,
  previewUrl: "preview"
}))): DurableJobRepository {
  return {
    getLatestAttempt: async () => attempt,
    getProjectOwnerId: async () => ids.owner,
    registerProviderOutput: register
  } as unknown as DurableJobRepository;
}

class MemoryOutputStore implements OutputObjectStore {
  readonly uploads: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];

  async uploadImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<"created"> {
    this.uploads.push({ path, bytes, contentType });
    return "created";
  }
}
