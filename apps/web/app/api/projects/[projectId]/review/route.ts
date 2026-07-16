import { reviewActionSchema } from "@droploop/schemas";
import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../lib/supabase/auth";

const reviewRequestSchema = z.object({
  clipId: z.string().uuid(),
  action: reviewActionSchema,
  reason: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().min(1).max(200)
});

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const { client } = await requireAuthenticatedSupabase();
    const queue = await new SupabaseProjectStore(client).listReviews(projectId);

    if (!queue) {
      throw new ApiError(404, "Project not found.", "project_not_found");
    }

    return Response.json({
      reviews: queue.reviews,
      clips: queue.clips.map((clip) => ({
        id: clip.id,
        clipId: clip.planned_clip_id,
        role: clip.role,
        status: clip.status,
        loopScore: clip.loop_score ?? 0,
        qualityScore: clip.quality_score ?? 0
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
    const body = reviewRequestSchema.parse(await request.json());
    const { client } = await requireAuthenticatedSupabase();
    const reviewInput = body.reason
      ? { projectId, clipId: body.clipId, action: body.action, reason: body.reason, idempotencyKey: body.idempotencyKey }
      : { projectId, clipId: body.clipId, action: body.action, idempotencyKey: body.idempotencyKey };
    const result = await new SupabaseProjectStore(client).applyReview(reviewInput);

    return Response.json({
      clipId: result.clip_id,
      action: result.action,
      status: result.review_status,
      clipStatus: result.clip_status,
      reason: result.reason,
      jobId: result.job_id,
      createdAt: result.created_at
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
