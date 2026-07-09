import { vjRecipeSchema } from "@droploop/schemas";
import type { VjRecipe } from "@droploop/schemas";

export function buildVjRecipeCatalog(): VjRecipe[] {
  return [
    {
      id: "audio_to_energy_map",
      label: "Audio to Energy Map",
      purpose: "Read BPM, mood, and set structure from lightweight audio metadata.",
      inputRoles: ["source_audio", "music_genre", "bpm"],
      outputRoles: ["energy_map"],
      status: "completed",
      progress: 100,
      summary: "Mapped BPM, intro, groove, drop, and transition energy for VJ timing."
    },
    {
      id: "visual_dna_builder",
      label: "Visual DNA Builder",
      purpose: "Lock palette, motif, texture, motion, and negative rules before generation.",
      inputRoles: ["mood_reference", "project_brief"],
      outputRoles: ["visual_dna"],
      status: "completed",
      progress: 100,
      summary: "Created stable VJ art direction with locked and flexible traits."
    },
    {
      id: "reference_recreation",
      label: "Reference Recreation",
      purpose: "Translate reference clips or moodboards into reusable VJ style direction.",
      inputRoles: ["mood_reference", "visual_dna"],
      outputRoles: ["styleframe", "visual_dna"],
      status: "completed",
      progress: 100,
      summary: "Recreated reference direction as VJ-safe style traits without copying protected content."
    },
    {
      id: "prompt_reverse_engineering",
      label: "Prompt Reverse Engineering",
      purpose: "Turn reference direction into structured prompt candidates for loop generation.",
      inputRoles: ["mood_reference", "styleframe"],
      outputRoles: ["clip_prompt"],
      status: "completed",
      progress: 100,
      summary: "Derived reusable loop prompts from reference descriptions and Visual DNA."
    },
    {
      id: "styleframe_batch",
      label: "Styleframe Batch",
      purpose: "Generate a small set of representative still directions before loop generation.",
      inputRoles: ["visual_dna", "energy_map"],
      outputRoles: ["styleframe", "thumbnail"],
      status: "completed",
      progress: 100,
      summary: "Prepared styleframe slots for ambient, groove, and drop looks."
    },
    {
      id: "loop_pack_generator",
      label: "Loop Pack Generator",
      purpose: "Generate loop-ready VJ clips from pack plan and styleframe direction.",
      inputRoles: ["styleframe", "clip_prompt"],
      outputRoles: ["vj_loop"],
      status: "completed",
      progress: 100,
      summary: "Generated deterministic mock VJ loops for pack review."
    },
    {
      id: "loop_doctor",
      label: "Loop Doctor",
      purpose: "Score seamlessness, brightness jumps, motion stability, and repair need.",
      inputRoles: ["vj_loop"],
      outputRoles: ["quality_score"],
      status: "completed",
      progress: 100,
      summary: "Checked loop continuity and repair recommendations."
    },
    {
      id: "stage_preview",
      label: "Stage Preview",
      purpose: "Estimate LED wall readability, contrast, and brightness safety.",
      inputRoles: ["vj_loop", "screen_format"],
      outputRoles: ["stage_preview"],
      status: "completed",
      progress: 100,
      summary: "Previewed LED wall readability and safe viewing distance."
    },
    {
      id: "export_pack",
      label: "Export Pack",
      purpose: "Package approved assets into VJ software folder plans and manifests.",
      inputRoles: ["approved_vj_loop", "safety_report"],
      outputRoles: ["export_manifest"],
      status: "completed",
      progress: 100,
      summary: "Prepared export manifests for VJ operator handoff."
    }
  ].map((recipe) => vjRecipeSchema.parse(recipe));
}
