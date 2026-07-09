import { buildExportPresetDetail, createDemoWorkspace } from "@droploop/pipeline";
import { exportManifestSchema } from "@droploop/schemas";

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
