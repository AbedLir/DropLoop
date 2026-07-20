import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../lib/supabase/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const { client } = await requireAuthenticatedSupabase();
    const detail = await new SupabaseProjectStore(client).getProject(projectId);

    if (!detail) {
      throw new ApiError(404, "Project not found.", "project_not_found");
    }

    return Response.json(detail);
  } catch (error) {
    return toErrorResponse(error);
  }
}
