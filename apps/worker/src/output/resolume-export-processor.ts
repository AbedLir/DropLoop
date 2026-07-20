import { createHash } from "node:crypto";
import {
  PRORES_4444_EXPORT_POLICY_V1,
  ProRes4444ExportError,
  assertProRes4444ExportProbe,
  exportVideoForResolumeBuffer,
  probeMediaBuffer,
  type LoopSafetyAnalysisResult,
  type MediaProbe,
  type ProRes4444ExportResult
} from "@droploop/media";
import { buildResolumeDeliveryManifest, type DurableJobRepository } from "@droploop/pipeline";
import type { GenerationJob, JobAttempt } from "@droploop/schemas";
import type { OutputObjectStore } from "./generated-output-registrar";

export const LOCAL_RESOLUME_EXPORT_PROVIDER = "resolume-export-local";
export const LOCAL_RESOLUME_EXPORT_MODEL = PRORES_4444_EXPORT_POLICY_V1.algorithmVersion;

export interface ResolumeExportObjectStore extends OutputObjectStore {
  download(path: string): Promise<Uint8Array>;
}

export type ResolumeExportProcessorOptions = {
  export?: (bytes: Uint8Array, filename: string, sourceProbe: MediaProbe) => Promise<ProRes4444ExportResult>;
  probe?: (bytes: Uint8Array, filename: string, expectedKind: "video") => Promise<MediaProbe>;
  now?: () => number;
};

export type ProcessedResolumeExport = {
  exportId: string;
  mediaStoragePath: string;
  manifestStoragePath: string;
  materializationLatencyMs: number;
};

export class ResolumeExportError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ResolumeExportError";
  }
}

export class ResolumeExportProcessor {
  private readonly now: () => number;
  private readonly exportVideo: NonNullable<ResolumeExportProcessorOptions["export"]>;
  private readonly probe: NonNullable<ResolumeExportProcessorOptions["probe"]>;

  constructor(
    private readonly repository: DurableJobRepository,
    private readonly objectStore: ResolumeExportObjectStore,
    options: ResolumeExportProcessorOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.exportVideo = options.export ?? exportVideoForResolumeBuffer;
    this.probe = options.probe ?? probeMediaBuffer;
  }

  async process(job: GenerationJob): Promise<ProcessedResolumeExport> {
    if (job.operation !== "export" || job.status !== "exporting") {
      throw new ResolumeExportError(`Job ${job.id} is not ready for a local Resolume export.`, false);
    }
    const attempt = await this.requireAttempt(job);
    const source = await this.repository.getResolumeExportSource(job.id);
    if (
      !source ||
      source.jobId !== job.id ||
      source.projectId !== job.projectId ||
      source.sourceAnalysisId !== job.sourceAnalysisId ||
      source.assetId !== job.sourceAssetId ||
      source.storageBucket !== "project-assets"
    ) {
      throw new ResolumeExportError(`Job ${job.id} no longer has an exportable immutable source and v3 seam evidence.`, false);
    }

    const startedAt = this.now();
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = await this.objectStore.download(source.storagePath);
    } catch (error) {
      throw exportError("Unable to read immutable Resolume export source", error, true);
    }

    let exportedBytes: Uint8Array;
    let sourceProbe;
    let outputProbe;
    try {
      sourceProbe = await this.probe(sourceBytes, source.filename, "video");
      if (sourceProbe.hasAlpha !== source.hasAlpha) {
        throw new ResolumeExportError("Stored source alpha metadata does not match decoded source media.", false);
      }
      const exported = await this.exportVideo(sourceBytes, source.filename, sourceProbe);
      exportedBytes = exported.bytes;
      outputProbe = await this.probe(exported.bytes, "resolume-delivery.mov", "video");
      assertProRes4444ExportProbe(sourceProbe, outputProbe, exported.alphaPreserved);
    } catch (error) {
      throw exportError("Unable to create a valid ProRes 4444 Resolume delivery", error, false);
    }

    const ownerId = await this.repository.getProjectOwnerId(job.projectId);
    if (!ownerId) throw new ResolumeExportError(`Project owner for job ${job.id} does not exist.`, false);
    const packageStoragePath = `${ownerId}/${job.projectId}/exports/${source.exportId}/`;
    const contentSha256 = createHash("sha256").update(exportedBytes).digest("hex");
    const filename = `${contentSha256}.mov`;
    const mediaStoragePath = `${packageStoragePath}media/${filename}`;
    const manifestStoragePath = `${packageStoragePath}manifest.json`;

    let manifest;
    try {
      manifest = buildResolumeDeliveryManifest({
        exportId: source.exportId,
        projectId: job.projectId,
        jobId: job.id,
        source: {
          assetId: source.assetId,
          sourceAnalysisId: source.sourceAnalysisId,
          contentSha256: source.sourceContentSha256,
          filename: source.filename,
          hasAlpha: source.hasAlpha
        },
        media: { filename, storagePath: mediaStoragePath, probe: outputProbe },
        loopEvidence: source.loopEvidence as LoopSafetyAnalysisResult
      });
      await this.objectStore.uploadImmutable(mediaStoragePath, exportedBytes, "video/quicktime");
      await this.objectStore.uploadImmutable(
        manifestStoragePath,
        new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
        "application/json"
      );
    } catch (error) {
      throw exportError("Unable to store immutable Resolume delivery files", error, true);
    }

    const materializationLatencyMs = Math.max(0, Math.round(this.now() - startedAt));
    try {
      await this.repository.updateAttempt(attempt.providerJobId, {
        status: "completed",
        costUsd: 0,
        result: { previewUrl: `storage://project-assets/${mediaStoragePath}` },
        latencyMs: materializationLatencyMs,
        rawResponse: {
          localTransform: PRORES_4444_EXPORT_POLICY_V1,
          sourceAssetId: source.assetId,
          sourceAnalysisId: source.sourceAnalysisId,
          outputContentSha256: contentSha256,
          manifestStoragePath
        },
        errorCategory: undefined,
        errorMessage: undefined,
        finishedAt: new Date(this.now()).toISOString()
      });
      await this.repository.completeResolumeExport({
        exportId: source.exportId,
        jobId: job.id,
        ownerId,
        packageStoragePath,
        mediaStoragePath,
        manifestStoragePath,
        manifest
      });
    } catch (error) {
      throw exportError("Unable to commit Resolume delivery evidence", error, true);
    }

    return { exportId: source.exportId, mediaStoragePath, manifestStoragePath, materializationLatencyMs };
  }

  private async requireAttempt(job: GenerationJob): Promise<JobAttempt & { providerJobId: string }> {
    const attempt = await this.repository.getLatestAttempt(job.id);
    if (
      !attempt ||
      attempt.provider !== LOCAL_RESOLUME_EXPORT_PROVIDER ||
      attempt.providerModel !== LOCAL_RESOLUME_EXPORT_MODEL ||
      !attempt.providerJobId ||
      (attempt.status !== "running" && attempt.status !== "completed")
    ) {
      throw new ResolumeExportError(`Job ${job.id} has no resumable local Resolume export attempt.`, false);
    }
    return attempt as JobAttempt & { providerJobId: string };
  }
}

function exportError(prefix: string, error: unknown, retryable: boolean): ResolumeExportError {
  if (error instanceof ResolumeExportError) return error;
  if (error instanceof ProRes4444ExportError) return new ResolumeExportError(`${prefix}: ${error.message}`, false);
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return new ResolumeExportError(`${prefix}: ${message}`, retryable);
}
