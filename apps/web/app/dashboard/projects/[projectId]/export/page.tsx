import { notFound } from "next/navigation";
import { z } from "zod";
import { SupabaseProjectStore } from "../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../lib/supabase/auth";
import { ResolumeExportControl } from "./resolume-export-control";

export default async function ExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) {
    notFound();
  }
  const { client } = await requireAuthenticatedSupabase();
  const store = new SupabaseProjectStore(client);
  const [detail, deliveries] = await Promise.all([store.getProject(projectId), store.listResolumeExports(projectId)]);
  if (!detail || !deliveries) {
    notFound();
  }

  return (
    <ResolumeExportControl
      projectId={projectId}
      initialApprovedClips={detail.clips
        .filter((clip) => clip.status === "approved")
        .map((clip) => ({
          id: clip.id,
          planned_clip_id: clip.planned_clip_id,
          role: clip.role,
          duration_seconds: clip.duration_seconds
        }))}
      initialExports={deliveries.map((delivery) => ({
        id: delivery.id,
        jobId: delivery.jobId,
        clipId: delivery.clipId,
        status: delivery.status,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        media: delivery.manifest
          ? {
              filename: delivery.manifest.media.filename,
              hasAlpha: delivery.manifest.media.hasAlpha,
              durationSeconds: delivery.manifest.media.durationSeconds,
              width: delivery.manifest.media.width,
              height: delivery.manifest.media.height,
              frameRate: delivery.manifest.media.frameRate
            }
          : null
      }))}
    />
  );
}
