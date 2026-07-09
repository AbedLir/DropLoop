import { describe, expect, it } from "vitest";
import { runProjectMockPipeline } from "@droploop/pipeline";

describe("runProjectMockPipeline", () => {
  it("turns project input into validated mock clips and an export manifest", async () => {
    const result = await runProjectMockPipeline({
      projectId: "test-project",
      projectName: "Warehouse Techno Night",
      template: "club",
      musicGenre: "warehouse techno",
      bpm: 132,
      showType: "club LED wall",
      screenFormat: "16:9",
      packSize: 12,
      desiredMood: "industrial strobes, steel tunnels, red haze",
      references: ["red haze moodboard", "wide LED wall"]
    });

    expect(result.brief.projectName).toBe("Warehouse Techno Night");
    expect(result.energyMap.bpm).toBe(132);
    expect(result.prompts.length).toBeGreaterThanOrEqual(2);
    expect(result.clips.length).toBe(result.prompts.length);
    expect(result.exportManifest.projectId).toBe("test-project");
    expect(result.exportManifest.includesSafetyReport).toBe(true);
    expect(result.recipes.map((recipe) => recipe.id)).toEqual([
      "audio_to_energy_map",
      "visual_dna_builder",
      "reference_recreation",
      "prompt_reverse_engineering",
      "styleframe_batch",
      "loop_pack_generator",
      "loop_doctor",
      "stage_preview",
      "export_pack"
    ]);
    expect(result.agentEvents[0].title).toBe("DROPLOOP Agent initialized");
    expect(result.assetClassifications.some((asset) => asset.role === "vj_loop")).toBe(true);
    expect(result.assetClassifications.some((asset) => asset.visualRole === "drop_hit")).toBe(true);
    expect(result.canvas.nodes.some((node) => node.type === "export_pack")).toBe(true);
    expect(result.stageResults.map((stage) => stage.stage)).toEqual([
      "project_brief",
      "asset_intelligence",
      "visual_dna",
      "energy_map",
      "pack_plan",
      "clip_prompts",
      "generate_video",
      "quality_judge",
      "loop_doctor",
      "stage_preview",
      "safety_check",
      "export_pack"
    ]);
    expect(result.stagePreview.surfaces).toContain("led_wall");
    expect(result.stagePreview.stageReadability).toBeGreaterThanOrEqual(75);
    expect(result.safetyReport.commercialUsageRisk).toBe("low");
    expect(result.reviewQueue.length).toBe(result.clips.length);
  });
});
