import { buildExportPresetDetail, createDemoWorkspace } from "@droploop/pipeline";
import { exportManifestSchema } from "@droploop/schemas";
import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../lib/supabase/auth";

const requestExportSchema = z.object({
  preset: z.literal("resolume"),
  clipId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200)
});

export async function GET(request: Request) {
  const workspace = await createDemoWorkspace();
  const url = new URL(request.url);
  const requestedPreset = url.searchParams.get("preset") ?? workspace.exportManifest.preset;
  const preset = exportManifestSchema.shape.preset.parse(requestedPreset);

  return Response.json({
    manifest: { ...workspace.exportManifest, preset },
    detail: buildExportPresetDetail(preset),
    safetyReport: workspace.safetyReport,
    assets: workspace.assetClassifications.filter((asset) => asset.exportable)
  });
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
