import { resolumeDeliveryManifestSchema } from "@droploop/schemas";
import type { LoopSafetyAnalysisResult, MediaProbe } from "@droploop/media";
import type { ResolumeDeliveryManifest } from "@droploop/schemas";

export type ResolumeDeliveryManifestInput = {
  exportId: string;
  projectId: string;
  jobId: string;
  source: {
    assetId: string;
    sourceAnalysisId: string;
    contentSha256: string;
    filename: string;
    hasAlpha: boolean;
  };
  media: {
    filename: string;
    storagePath: string;
    probe: MediaProbe;
  };
  loopEvidence: LoopSafetyAnalysisResult;
};

export function buildResolumeDeliveryManifest(input: ResolumeDeliveryManifestInput): ResolumeDeliveryManifest {
  const probe = input.media.probe;
  if (
    probe.kind !== "video" ||
    probe.videoCodec !== "prores" ||
    probe.pixelFormat === null ||
    probe.durationSeconds === null ||
    probe.width === null ||
    probe.height === null ||
    probe.frameRate === null ||
    probe.hasAlpha === null
  ) {
    throw new Error("Resolume delivery manifest requires a fully-probed ProRes video.");
  }
  if (input.loopEvidence.algorithmVersion !== "boundary-seam-window-gray-v3" || input.loopEvidence.decision !== "pass") {
    throw new Error("Resolume delivery manifest requires current passing seam-window loop evidence.");
  }
  if (input.source.hasAlpha !== probe.hasAlpha) {
    throw new Error("Resolume delivery manifest refuses an alpha mismatch between source and delivery media.");
  }

  return resolumeDeliveryManifestSchema.parse({
    schemaVersion: "resolume-delivery-v1",
    exportId: input.exportId,
    projectId: input.projectId,
    jobId: input.jobId,
    preset: "resolume",
    deliveryState: "ready_for_manual_resolume_import",
    source: input.source,
    media: {
      filename: input.media.filename,
      storagePath: input.media.storagePath,
      mimeType: "video/quicktime",
      codec: "prores",
      pixelFormat: probe.pixelFormat,
      hasAlpha: probe.hasAlpha,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      frameRate: probe.frameRate
    },
    loopEvidence: {
      algorithmVersion: input.loopEvidence.algorithmVersion,
      decision: input.loopEvidence.decision,
      seamContinuityScore: input.loopEvidence.seamContinuityScore,
      brightnessSafetyScore: input.loopEvidence.brightnessSafetyScore,
      flickerSafetyScore: input.loopEvidence.flickerSafetyScore
    },
    operatorNotes: [
      "Import the MOV into Resolume as a file; keep the generated manifest beside the media for provenance.",
      "The file has no audio because the visual loop delivery path strips audio deliberately.",
      probe.hasAlpha ? "Alpha was preserved and must be checked against the target deck blend mode." : "This source is intentionally opaque; do not configure an alpha blend mode."
    ],
    unresolvedAcceptance: [
      "Manual Resolume import and a sustained hardware playback run remain required.",
      "DXV3 licensing and encoding are not represented by this ProRes delivery."
    ]
  });
}
