import { z } from "zod";
import { toErrorResponse } from "../../../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../lib/supabase/auth";

const selectionSchema = z.object({
  selectedBpm: z.number().int().min(40).max(240),
  source: z.enum(["analysis", "manual_override"]),
  analysisAssetId: z.string().uuid().optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const body = selectionSchema.parse(await request.json());
    const { client } = await requireAuthenticatedSupabase();
    const input = body.analysisAssetId
      ? { projectId, selectedBpm: body.selectedBpm, source: body.source, analysisAssetId: body.analysisAssetId }
      : { projectId, selectedBpm: body.selectedBpm, source: body.source };
    const project = await new SupabaseProjectStore(client).setBpmSelection(input);
    return Response.json({ project });
  } catch (error) {
    return toErrorResponse(error);
  }
}
