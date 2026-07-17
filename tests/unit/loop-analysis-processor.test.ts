import type { LoopAnalysisResult } from "@droploop/media";
import type {
  DurableJobRepository,
  RegisterLoopAnalysisInput,
  StoredLoopAnalysis,
  ValidationAsset
} from "@droploop/pipeline";
import { generationJobSchema } from "@droploop/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  LoopAnalysisProcessor,
  LoopValidationError
} from "../../apps/worker/src/output/loop-analysis-processor";

const job = generationJobSchema.parse({
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "22222222-2222-4222-8222-222222222222",
  workflowId: "workflow-1",
  orchestrationMode: "solo",
  operation: "generate",
  idempotencyKey: "generate-1",
  status: "validating",
  progress: 85,
  input: {},
  outputAssetId: "55555555-5555-4555-8555-555555555555",
  attemptCount: 1,
  maxAttempts: 3,
  costUsd: 0,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z"
});

const asset: ValidationAsset = {
  assetId: job.outputAssetId as string,
  jobId: job.id,
  projectId: job.projectId,
  storageBucket: "project-assets",
  storagePath: "owner/project/outputs/job/attempt/output.mp4",
  filename: "output.mp4",
  durationSeconds: 8,
  frameRate: 30
};

const result: LoopAnalysisResult = {
  algorithmVersion: "boundary-gray-mae-v1",
  decision: "repair_required",
  loopScore: 70,
  boundaryMaePercent: 30,
  firstFrameLumaPercent: 40,
  lastFrameLumaPercent: 60,
  brightnessJumpPercent: 20,
  firstFrameBlack: false,
  lastFrameBlack: false,
  reasons: ["Boundary MAE 30% exceeds 12%."],
  policy: {
    algorithmVersion: "boundary-gray-mae-v1",
    frameWidth: 64,
    frameHeight: 64,
    maxBoundaryMaePercent: 12,
    maxBrightnessJumpPercent: 8,
    blackFrameLumaFloorPercent: 2
  }
};

describe("loop analysis processor", () => {
  it("reads the private immutable output and persists versioned decoded evidence", async () => {
    const register = vi.fn(async (input: RegisterLoopAnalysisInput): Promise<StoredLoopAnalysis> => ({
      ...input,
      createdAt: "2026-07-17T00:01:00.000Z"
    }));
    const repository = repositoryWith({ register });
    const download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const analyze = vi.fn(async () => result);

    const stored = await new LoopAnalysisProcessor(repository, { download }, analyze).process(job);

    expect(download).toHaveBeenCalledWith(asset.storagePath);
    expect(analyze).toHaveBeenCalledWith(expect.any(Uint8Array), asset.filename, 8, 30);
    expect(stored.result.decision).toBe("repair_required");
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      jobId: job.id,
      assetId: asset.assetId,
      analysisId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      result
    }));
  });

  it("resumes from persisted evidence without downloading the asset again", async () => {
    const existing: StoredLoopAnalysis = {
      analysisId: "66666666-6666-4666-8666-666666666666",
      jobId: job.id,
      assetId: asset.assetId,
      result,
      createdAt: "2026-07-17T00:01:00.000Z"
    };
    const download = vi.fn(async () => new Uint8Array([1]));
    const stored = await new LoopAnalysisProcessor(repositoryWith({ existing }), { download }).process(job);

    expect(stored).toEqual(existing);
    expect(download).not.toHaveBeenCalled();
  });

  it("classifies missing immutable asset linkage as non-retryable", async () => {
    const repository = repositoryWith({ validationAsset: null });
    await expect(new LoopAnalysisProcessor(repository, { download: async () => new Uint8Array([1]) }).process(job))
      .rejects.toMatchObject<Partial<LoopValidationError>>({ retryable: false });
  });
});

function repositoryWith(options: {
  existing?: StoredLoopAnalysis | null;
  validationAsset?: ValidationAsset | null;
  register?: (input: RegisterLoopAnalysisInput) => Promise<StoredLoopAnalysis>;
} = {}): DurableJobRepository {
  return {
    getLatestLoopAnalysis: async () => options.existing ?? null,
    getValidationAsset: async () => options.validationAsset === undefined ? asset : options.validationAsset,
    registerLoopAnalysis: options.register ?? (async (input) => ({ ...input, createdAt: "2026-07-17T00:01:00.000Z" }))
  } as unknown as DurableJobRepository;
}
