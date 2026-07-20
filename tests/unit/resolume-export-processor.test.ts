import type { LoopSafetyAnalysisResult, MediaProbe, ProRes4444ExportResult } from "@droploop/media";
import { PRORES_4444_EXPORT_POLICY_V1 } from "@droploop/media";
import type { DurableJobRepository, ResolumeExportSource } from "@droploop/pipeline";
import { generationJobSchema, jobAttemptSchema } from "@droploop/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_RESOLUME_EXPORT_MODEL,
  LOCAL_RESOLUME_EXPORT_PROVIDER,
  ResolumeExportProcessor,
  type ResolumeExportObjectStore
} from "../../apps/worker/src/output/resolume-export-processor";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
  asset: "55555555-5555-4555-8555-555555555555",
  analysis: "66666666-6666-4666-8666-666666666666",
  export: "77777777-7777-4777-8777-777777777777"
};

const job = generationJobSchema.parse({
  id: ids.job,
  projectId: ids.project,
  workflowId: ids.job,
  orchestrationMode: "solo",
  operation: "export",
  idempotencyKey: "resolume-export:clip-1",
  status: "exporting",
  progress: 10,
  input: { exportId: ids.export, clipId: "88888888-8888-4888-8888-888888888888", preset: "resolume" },
  provider: LOCAL_RESOLUME_EXPORT_PROVIDER,
  providerModel: LOCAL_RESOLUME_EXPORT_MODEL,
  providerJobId: `local-resolume-export:${ids.job}:${LOCAL_RESOLUME_EXPORT_MODEL}`,
  attemptCount: 1,
  maxAttempts: 3,
  costUsd: 0,
  sourceAssetId: ids.asset,
  sourceAnalysisId: ids.analysis,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z"
});

const attempt = jobAttemptSchema.parse({
  id: ids.attempt,
  jobId: ids.job,
  attemptNumber: 1,
  provider: LOCAL_RESOLUME_EXPORT_PROVIDER,
  providerModel: LOCAL_RESOLUME_EXPORT_MODEL,
  providerJobId: job.providerJobId,
  status: "running",
  costUsd: 0,
  startedAt: "2026-07-20T00:00:00.000Z"
});

const sourceProbe: MediaProbe = {
  kind: "video",
  durationSeconds: 8,
  width: 1920,
  height: 1080,
  frameRate: 30,
  codec: "h264",
  pixelFormat: "yuva420p",
  hasAlpha: true,
  formatName: "mov,mp4,m4a,3gp,3g2,mj2",
  audioCodec: null,
  videoCodec: "h264"
};

const outputProbe: MediaProbe = {
  ...sourceProbe,
  codec: "prores",
  pixelFormat: "yuva444p12le",
  formatName: "mov",
  videoCodec: "prores"
};

const loopEvidence: LoopSafetyAnalysisResult = {
  algorithmVersion: "boundary-seam-window-gray-v3",
  decision: "pass",
  loopScore: 99,
  boundaryMaePercent: 1,
  firstFrameLumaPercent: 48,
  lastFrameLumaPercent: 49,
  brightnessJumpPercent: 1,
  firstFrameBlack: false,
  lastFrameBlack: false,
  reasons: [],
  sampleFramesPerSecond: 12,
  sampledFrameCount: 96,
  blackFrameCount: 0,
  blackFrameRatioPercent: 0,
  maxAdjacentBrightnessJumpPercent: 2,
  p95AdjacentBrightnessJumpPercent: 1,
  flashReversalCount: 0,
  flashReversalsPerSecond: 0,
  brightnessSafetyScore: 98,
  flickerSafetyScore: 100,
  seamWindowFrameCount: 6,
  seamTransitionMaePercent: 1,
  seamReferenceP95MaePercent: 2,
  seamTransitionOutlierRatio: 0.5,
  seamJerkPercent: 1,
  seamReferenceP95JerkPercent: 2,
  seamJerkOutlierRatio: 0.5,
  seamContinuityScore: 100,
  policy: {
    algorithmVersion: "boundary-seam-window-gray-v3",
    frameWidth: 64,
    frameHeight: 64,
    maxBoundaryMaePercent: 12,
    maxBrightnessJumpPercent: 8,
    blackFrameLumaFloorPercent: 2,
    sampleFramesPerSecond: 12,
    maxRepresentativeFrames: 240,
    maxBlackFrameRatioPercent: 0,
    maxAdjacentBrightnessJumpPercent: 35,
    flashBrightnessDeltaPercent: 18,
    maxFlashReversalsPerSecond: 3,
    seamWindowSeconds: 0.5,
    maxSeamTransitionOutlierRatio: 2.5,
    maxSeamJerkOutlierRatio: 3
  }
};

const source: ResolumeExportSource = {
  exportId: ids.export,
  assetId: ids.asset,
  jobId: ids.job,
  projectId: ids.project,
  sourceAnalysisId: ids.analysis,
  storageBucket: "project-assets",
  storagePath: "owner/project/source.mov",
  filename: "source.mov",
  durationSeconds: 8,
  frameRate: 30,
  hasAlpha: true,
  sourceContentSha256: "a".repeat(64),
  loopEvidence
};

describe("Resolume export processor", () => {
  it("stores a ProRes media artifact and matching immutable delivery manifest before committing completion", async () => {
    let updatedAttempt = attempt;
    const complete = vi.fn(async (input) => {
      expect(updatedAttempt.status).toBe("completed");
      expect(input).toMatchObject({
        exportId: ids.export,
        jobId: ids.job,
        ownerId: ids.owner,
        packageStoragePath: `${ids.owner}/${ids.project}/exports/${ids.export}/`,
        mediaStoragePath: expect.stringMatching(/\.mov$/),
        manifestStoragePath: `${ids.owner}/${ids.project}/exports/${ids.export}/manifest.json`
      });
      expect(input.manifest.source).toMatchObject({ assetId: ids.asset, sourceAnalysisId: ids.analysis, hasAlpha: true });
      expect(input.manifest.media).toMatchObject({ codec: "prores", hasAlpha: true, pixelFormat: "yuva444p12le" });
    });
    const repository = {
      getLatestAttempt: async () => updatedAttempt,
      getResolumeExportSource: async () => source,
      getProjectOwnerId: async () => ids.owner,
      updateAttempt: async (_providerJobId: string, changes: Partial<typeof attempt>) => {
        updatedAttempt = jobAttemptSchema.parse({ ...updatedAttempt, ...changes });
        return updatedAttempt;
      },
      completeResolumeExport: complete
    } as unknown as DurableJobRepository;
    const store = new MemoryExportStore();
    const exportResult: ProRes4444ExportResult = {
      bytes: new Uint8Array([9, 8, 7]),
      policy: { ...PRORES_4444_EXPORT_POLICY_V1 },
      alphaPreserved: true
    };
    const probe = vi.fn(async (_bytes: Uint8Array, filename: string) => filename === "source.mov" ? sourceProbe : outputProbe);
    const clock = [1000, 1450, 1450, 1450];

    const result = await new ResolumeExportProcessor(repository, store, {
      export: async () => exportResult,
      probe,
      now: () => clock.shift() ?? 1450
    }).process(job);

    expect(result.materializationLatencyMs).toBe(450);
    expect(store.downloads).toEqual([source.storagePath]);
    expect(store.uploads.map((item) => item.contentType)).toEqual(["video/quicktime", "application/json"]);
    expect(complete).toHaveBeenCalledOnce();
  });
});

class MemoryExportStore implements ResolumeExportObjectStore {
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
