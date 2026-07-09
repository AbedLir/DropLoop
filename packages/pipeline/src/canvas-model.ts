import { canvasModelSchema } from "@droploop/schemas";
import type { AssetClassification, CanvasModel, VjRecipe } from "@droploop/schemas";

export function buildCanvasModel(projectId: string, recipes: VjRecipe[], assets: AssetClassification[]): CanvasModel {
  const nodes = [
    {
      id: `${projectId}-brief`,
      type: "brief" as const,
      title: "VJ Pack Brief",
      subtitle: "DJ set, BPM, screen format, and visual constraints",
      status: "completed" as const,
      x: 40,
      y: 40,
      width: 320,
      height: 180,
      assetIds: assets.filter((asset) => asset.role === "source_audio" || asset.role === "mood_reference").map((asset) => asset.id)
    },
    ...recipes.map((recipe, index) => ({
      id: `recipe-${recipe.id}`,
      type: "recipe" as const,
      title: recipe.label,
      subtitle: recipe.summary,
      status: "completed" as const,
      x: 420 + (index % 3) * 340,
      y: 40 + Math.floor(index / 3) * 220,
      width: 300,
      height: 170,
      assetIds: assets.filter((asset) => recipe.outputRoles.includes(asset.role)).map((asset) => asset.id)
    })),
    {
      id: `${projectId}-export-pack`,
      type: "export_pack" as const,
      title: "Export Pack",
      subtitle: "Approved loops, thumbnails, safety report, and manifest",
      status: "completed" as const,
      x: 420,
      y: 560,
      width: 640,
      height: 220,
      assetIds: assets.filter((asset) => asset.exportable).map((asset) => asset.id)
    }
  ];

  const edges = [
    { id: "brief-to-first-recipe", from: `${projectId}-brief`, to: `recipe-${recipes[0]?.id ?? "audio_to_energy_map"}`, label: "starts" },
    ...recipes.slice(0, -1).map((recipe, index) => ({
      id: `${recipe.id}-to-${recipes[index + 1]?.id}`,
      from: `recipe-${recipe.id}`,
      to: `recipe-${recipes[index + 1]?.id}`,
      label: "feeds"
    })),
    { id: "last-recipe-to-export", from: `recipe-${recipes.at(-1)?.id ?? "export_pack"}`, to: `${projectId}-export-pack`, label: "packages" }
  ];

  return canvasModelSchema.parse({ nodes, edges });
}
