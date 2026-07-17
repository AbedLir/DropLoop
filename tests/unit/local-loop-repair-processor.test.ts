import type { LoopRepairResult, MediaProbe } from "@droploop/media";
import type {
  DurableJobRepository,
  RegisterProviderOutputInput,
  RepairSourceAsset
} from "@droploop/pipeline";
import { generationJobSchema, jobAttemptSchema } from "@droploop/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_LOOP_REPAIR_MODEL,
  LOCAL_LOOP_REPAIR_PROVIDER,
  LocalLoopRepairProcessor,
  type RepairObjectStore
} from "../../apps/worker/src/output/local-loop-repair-processor";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
  sourceAsset: "55555555-5555-4555-8555-555555555555",
  sourceAnalysis: "66666666-6666-4666-8666-666666666666"
};

const job = generationJobSchema.parse({
  id: ids.job,
  projectId: ids.project,
  workflowId: "repair-workflow",
  orchestrationMode: "solo",
  operation: "repair",
  idempotencyKey: "repair-1",
  status: "repairing",
  progress: 10,
  input: {},
  provider: LOCAL_LOOP_REPAIR_PROVIDER,
  providerModel: LOCAL_LOOP_REPAIR_MODEL,
  providerJobId: `local-loop-doctor:${ids.job}:${LOCAL_LOOP_REPAIR_MODEL}`,
  attemptCount: 1,
  maxAttempts: 3,
  costUsd: 0,
  sourceAssetId: ids.sourceAsset,
  sourceAnalysisId: ids.sourceAnalysis,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z"
});

const attempt = jobAttemptSchema.parse({
  id: ids.attempt,
  jobId: ids.job,
  attemptNumber: 1,
  provider: LOCAL_LOOP_REPAIR_PROVIDER,
  providerModel: LOCAL_LOOP_REPAIR_MODEL,
  providerJobId: job.providerJobId,
  status: "running",
  costUsd: 0,
  startedAt: "2026-07-17T00:00:00.000Z"
});

const source: RepairSourceAsset = {
  assetId: ids.sourceAsset,
  jobId: ids.job,
  projectId: ids.project,
  sourceAnalysisId: ids.sourceAnalysis,
  storageBucket: "project-assets",
  storagePath: "owner/project/source.mp4",
  filename: "source.mp4",
  durationSeconds: 8,
  frameRate: 30,
  hasAlpha: false
};

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

describe("local loop repair processor", () => {
  it("records a zero-cost local attempt before registering the immutable output", async () => {
    let updatedAttempt = attempt;
    const register = vi.fn(async (input: RegisterProviderOutputInput) => {
      expect(updatedAttempt.status).toBe("completed");
      expect(updatedAttempt.result?.previewUrl).toBe(`storage://${input.storageBucket}/${input.storagePath}`);
      return {
        assetId: input.assetId,
        projectId: ids.project,
        jobId: ids.job,
        attemptId: ids.attempt,
        storageBucket: input.storageBucket,
        storagePath: input.storagePath,
        previewUrl: "private-preview"
      };
    });
    const repository = {
      getLatestAttempt: async () => updatedAttempt,
      getRepairSource: async () => source,
      getProjectOwnerId: async () => ids.owner,
      updateAttempt: async (_providerJobId: string, changes: Partial<typeof attempt>) => {
        updatedAttempt = jobAttemptSchema.parse({ ...updatedAttempt, ...changes });
        return updatedAttempt;
      },
      registerProviderOutput: register
    } as unknown as DurableJobRepository;
    const store = new MemoryRepairStore();
    const policy: LoopRepairResult["policy"] = {
      algorithmVersion: LOCAL_LOOP_REPAIR_MODEL,
      transitionSeconds: 0.5,
      videoCodec: "libx264",
      constantRateFactor: 18,
      encoderPreset: "medium",
      pixelFormat: "yuv420p",
      preserveDuration: true,
      stripAudio: true,
      supportsAlpha: false
    };
    const clock = [1000, 1450, 1450];
    const output = await new LocalLoopRepairProcessor(repository, store, {
      repair: async () => ({ bytes: new Uint8Array([9, 8, 7]), policy }),
      probe: async () => probe,
      now: () => clock.shift() ?? 1450
    }).process(job);

    expect(output.materializationLatencyMs).toBe(450);
    expect(store.downloads).toEqual([source.storagePath]);
    expect(store.uploads).toHaveLength(1);
    expect(updatedAttempt).toMatchObject({
      status: "completed",
      costUsd: 0,
      latencyMs: 450,
      rawResponse: {
        localTransform: policy,
        sourceAssetId: ids.sourceAsset,
        sourceAnalysisId: ids.sourceAnalysis
      }
    });
    expect(register).toHaveBeenCalledOnce();
  });

  it("resumes after output registration without rerunning the transform", async () => {
    const repair = vi.fn();
    const completedJob = generationJobSchema.parse({ ...job, outputAssetId: "asset-output", downloadLatencyMs: 321 });
    const repository = {} as DurableJobRepository;
    const output = await new LocalLoopRepairProcessor(repository, new MemoryRepairStore(), { repair }).process(completedJob);
    expect(output).toEqual({ assetId: "asset-output", materializationLatencyMs: 321 });
    expect(repair).not.toHaveBeenCalled();
  });
});

class MemoryRepairStore implements RepairObjectStore {
  readonly downloads: string[] = [];
  readonly uploads: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];

  async download(path: string): Promise<Uint8Array> {
    this.downloads.push(path);
    return new Uint8Array([1, 2, 3]);
  }

  async uploadImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<"created"> {
    this.uploads.push({ path, bytes, contentType });
    return "created";
  }
}
