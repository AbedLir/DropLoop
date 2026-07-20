import { resolumeDeliveryManifestSchema, type ResolumeDeliveryManifest } from "@droploop/schemas";
import { z } from "zod";

export const resolumeExportStatusSchema = z.enum(["queued", "exporting", "completed", "failed", "cancelled"]);

export const resolumeExportRowSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  job_id: z.string().uuid().nullable(),
  preset: z.literal("resolume"),
  status: resolumeExportStatusSchema,
  clip_id: z.string().uuid().nullable(),
  source_asset_id: z.string().uuid().nullable(),
  source_analysis_id: z.string().uuid().nullable(),
  storage_bucket: z.string().nullable(),
  storage_path: z.string().nullable(),
  manifest: z.unknown(),
  created_at: z.string(),
  updated_at: z.string()
});

export type PersistedResolumeExport = {
  id: string;
  projectId: string;
  jobId: string | null;
  status: z.infer<typeof resolumeExportStatusSchema>;
  clipId: string | null;
  sourceAssetId: string | null;
  sourceAnalysisId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  manifest: ResolumeDeliveryManifest | null;
  createdAt: string;
  updatedAt: string;
};

export type ResolumeDeliveryArtifact = "media" | "manifest";

export function mapResolumeExport(row: z.infer<typeof resolumeExportRowSchema>): PersistedResolumeExport {
  const parsedManifest = resolumeDeliveryManifestSchema.safeParse(row.manifest);
  return {
    id: row.id,
    projectId: row.project_id,
    jobId: row.job_id,
    status: row.status,
    clipId: row.clip_id,
    sourceAssetId: row.source_asset_id,
    sourceAnalysisId: row.source_analysis_id,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    manifest: parsedManifest.success ? parsedManifest.data : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function resolveResolumeDeliveryArtifact(
  delivery: PersistedResolumeExport,
  artifact: ResolumeDeliveryArtifact
): { bucket: string; path: string; downloadName: string } | null {
  if (
    delivery.status !== "completed" ||
    delivery.storageBucket !== "project-assets" ||
    !delivery.storagePath ||
    !delivery.manifest ||
    !delivery.jobId ||
    delivery.manifest.exportId !== delivery.id ||
    delivery.manifest.projectId !== delivery.projectId ||
    delivery.manifest.jobId !== delivery.jobId ||
    !delivery.storagePath.endsWith("/") ||
    !delivery.manifest.media.storagePath.startsWith(delivery.storagePath)
  ) {
    return null;
  }

  if (artifact === "media") {
    return {
      bucket: delivery.storageBucket,
      path: delivery.manifest.media.storagePath,
      downloadName: delivery.manifest.media.filename
    };
  }

  return {
    bucket: delivery.storageBucket,
    path: `${delivery.storagePath}manifest.json`,
    downloadName: "manifest.json"
  };
}
