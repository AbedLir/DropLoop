import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../../../lib/supabase/auth";

export const runtime = "nodejs";

const identifierSchema = z.string().uuid();
const artifactSchema = z.enum(["media", "manifest"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; exportId: string; artifact: string }> }
) {
  try {
    const { projectId, exportId, artifact } = await params;
    identifierSchema.parse(projectId);
    identifierSchema.parse(exportId);
    const { client } = await requireAuthenticatedSupabase();
    const resolved = await new SupabaseProjectStore(client).getResolumeExportArtifact({
      projectId,
      exportId,
      artifact: artifactSchema.parse(artifact)
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: resolved.signedUrl,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return toErrorResponse(error instanceof z.ZodError ? new ApiError(400, error.message, "invalid_export_artifact") : error);
  }
}
