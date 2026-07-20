import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../lib/supabase/auth";

const requestExportSchema = z.object({
  preset: z.literal("resolume"),
  clipId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200)
});

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const { client } = await requireAuthenticatedSupabase();
    const store = new SupabaseProjectStore(client);
    const [detail, exports] = await Promise.all([store.getProject(projectId), store.listResolumeExports(projectId)]);
    if (!detail || !exports) {
      throw new ApiError(404, "Project not found.", "project_not_found");
    }
    return Response.json({
      approvedClips: detail.clips.filter((clip) => clip.status === "approved"),
      exports: exports.map((delivery) => ({
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
      }))
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const body = requestExportSchema.parse(await request.json());
    const { client } = await requireAuthenticatedSupabase();
    const delivery = await new SupabaseProjectStore(client).requestResolumeExport({
      projectId,
      clipId: body.clipId,
      idempotencyKey: body.idempotencyKey
    });
    return Response.json({
      exportId: delivery.export_id,
      jobId: delivery.job_id,
      status: delivery.status,
      createdAt: delivery.created_at,
      acceptance: "A successful job produces a ProRes 4444 delivery record; Resolume import remains a separate manual gate."
    }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error instanceof z.ZodError ? new ApiError(400, error.message, "invalid_export_request") : error);
  }
}
