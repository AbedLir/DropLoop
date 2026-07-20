import { describe, expect, it } from "vitest";
import {
  resolveResolumeDeliveryArtifact,
  type PersistedResolumeExport
} from "../../apps/web/lib/projects/resolume-export-artifact";

const ids = {
  export: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  clip: "44444444-4444-4444-8444-444444444444",
  asset: "55555555-5555-4555-8555-555555555555",
  analysis: "66666666-6666-4666-8666-666666666666"
};

const prefix = `owner/${ids.project}/exports/${ids.export}/`;

function completedDelivery(): PersistedResolumeExport {
  return {
    id: ids.export,
    projectId: ids.project,
    jobId: ids.job,
    status: "completed",
    clipId: ids.clip,
    sourceAssetId: ids.asset,
    sourceAnalysisId: ids.analysis,
    storageBucket: "project-assets",
    storagePath: prefix,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    manifest: {
      schemaVersion: "resolume-delivery-v1",
      exportId: ids.export,
      projectId: ids.project,
      jobId: ids.job,
      preset: "resolume",
      deliveryState: "ready_for_manual_resolume_import",
      source: {
        assetId: ids.asset,
        sourceAnalysisId: ids.analysis,
        contentSha256: "a".repeat(64),
        filename: "source.mov",
        hasAlpha: true
      },
      media: {
        filename: "delivery.mov",
        storagePath: `${prefix}media/delivery.mov`,
        mimeType: "video/quicktime",
        codec: "prores",
        pixelFormat: "yuva444p12le",
        hasAlpha: true,
        durationSeconds: 8,
        width: 1920,
        height: 1080,
        frameRate: 30
      },
      loopEvidence: {
        algorithmVersion: "boundary-seam-window-gray-v3",
        decision: "pass",
        seamContinuityScore: 100,
        brightnessSafetyScore: 98,
        flickerSafetyScore: 100
      },
      operatorNotes: ["Fixture delivery"],
      unresolvedAcceptance: ["Manual Resolume import remains required."]
    }
  };
}

describe("private Resolume delivery artifact resolver", () => {
  it("resolves only the exact MOV and manifest beneath a completed delivery prefix", () => {
    const delivery = completedDelivery();

    expect(resolveResolumeDeliveryArtifact(delivery, "media")).toEqual({
      bucket: "project-assets",
      path: `${prefix}media/delivery.mov`,
      downloadName: "delivery.mov"
    });
    expect(resolveResolumeDeliveryArtifact(delivery, "manifest")).toEqual({
      bucket: "project-assets",
      path: `${prefix}manifest.json`,
      downloadName: "manifest.json"
    });
  });

  it("fails closed for incomplete jobs or a manifest outside the immutable export prefix", () => {
    const queued = { ...completedDelivery(), status: "queued" as const };
    expect(resolveResolumeDeliveryArtifact(queued, "media")).toBeNull();

    const substituted = completedDelivery();
    substituted.manifest = {
      ...substituted.manifest!,
      media: { ...substituted.manifest!.media, storagePath: "owner/other-project/exports/other/media/delivery.mov" }
    };
    expect(resolveResolumeDeliveryArtifact(substituted, "media")).toBeNull();
  });
});
