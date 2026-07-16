import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../../../../lib/api-errors";
import { requireAuthenticatedSupabase } from "../../../../../../../lib/supabase/auth";

export const runtime = "nodejs";

const identifierSchema = z.string().uuid();
const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
) {
  try {
    const { projectId, assetId } = await params;
    identifierSchema.parse(projectId);
    identifierSchema.parse(assetId);
    const { client } = await requireAuthenticatedSupabase();
    const { data: asset, error: assetError } = await client
      .from("project_assets")
      .select("id, project_id, storage_bucket, storage_path, status")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("status", "ready")
      .maybeSingle();

    if (assetError || !asset || asset.storage_bucket !== "project-assets" || !asset.storage_path) {
      throw new ApiError(404, "Playable asset not found.", "asset_not_found");
    }

    const { data: signed, error: signedError } = await client.storage
      .from(asset.storage_bucket)
      .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signed?.signedUrl) {
      throw new ApiError(502, "Unable to create a playable asset URL.", "asset_signing_failed");
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: signed.signedUrl,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
