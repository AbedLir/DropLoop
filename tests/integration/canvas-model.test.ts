import { buildCanvasModel, buildVjRecipeCatalog, classifyVjAssets } from "@droploop/pipeline";
import type { GeneratedClip, ReferenceAsset } from "@droploop/schemas";
import { describe, expect, it } from "vitest";

describe("buildCanvasModel", () => {
  it("connects brief, recipes, and export pack nodes", () => {
    const references: ReferenceAsset[] = [
      {
        id: "audio",
        type: "audio",
        filename: "set.wav",
        mimeType: "audio/wav",
        sizeBytes: 100,
        description: "132 BPM",
        rightsStatus: "user_owned",
        detectedRisk: "low"
      }
    ];
    const clips: GeneratedClip[] = [
      {
        id: "clip-1",
        clipId: "ambient-1",
        role: "ambient",
        status: "generated",
        previewUrl: "/ambient.mp4",
        thumbnailUrl: "/ambient.jpg",
        durationSeconds: 8,
        loopScore: 86,
        qualityScore: 88
      }
    ];
    const recipes = buildVjRecipeCatalog();
    const assets = classifyVjAssets("project", references, clips);
    const canvas = buildCanvasModel("project", recipes, assets);

    expect(canvas.nodes[0].type).toBe("brief");
    expect(canvas.nodes.some((node) => node.type === "export_pack")).toBe(true);
    expect(canvas.edges.length).toBeGreaterThanOrEqual(recipes.length);
  });
});
