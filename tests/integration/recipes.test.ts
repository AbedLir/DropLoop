import { buildVjRecipeCatalog } from "@droploop/pipeline";
import { describe, expect, it } from "vitest";

describe("buildVjRecipeCatalog", () => {
  it("returns the ordered MVP VJ recipe chain", () => {
    const recipes = buildVjRecipeCatalog();

    expect(recipes.map((recipe) => recipe.id)).toEqual([
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
    expect(recipes.every((recipe) => recipe.status === "completed")).toBe(true);
  });
});
