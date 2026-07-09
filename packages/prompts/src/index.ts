import type { ClipPrompt, EnergyMap, PackPlan, ProjectBrief, VisualDna } from "@droploop/schemas";

export type PromptMessage = {
  system: string;
  user: string;
};

export function buildProjectBriefPrompt(input: string): PromptMessage {
  return {
    system: "You are a professional VJ creative director. Output JSON only.",
    user: `Convert this project input into a structured VJ project brief without generating video prompts:\n${input}`
  };
}

export function buildVisualDnaPrompt(brief: ProjectBrief): PromptMessage {
  return {
    system: "You are a senior VJ art director. Output JSON only.",
    user: `Create stable Visual DNA for this brief:\n${JSON.stringify(brief, null, 2)}`
  };
}

export function buildEnergyMapPrompt(brief: ProjectBrief): PromptMessage {
  return {
    system: "You are a VJ show programmer. Output JSON only.",
    user: `Translate this music and show brief into a visual energy map:\n${JSON.stringify(brief, null, 2)}`
  };
}

export function buildPackPlanPrompt(brief: ProjectBrief, dna: VisualDna, energyMap: EnergyMap): PromptMessage {
  return {
    system: "You are a VJ pack planner. Output JSON only.",
    user: `Plan a useful stage-ready VJ pack:\n${JSON.stringify({ brief, dna, energyMap }, null, 2)}`
  };
}

export function buildClipPrompts(plan: PackPlan): ClipPrompt[] {
  return plan.clips.map((clip) => ({
    clipId: clip.clipId,
    role: clip.category,
    durationSeconds: clip.durationSeconds,
    energy: clip.energy,
    positivePrompt: [
      "abstract stage-ready VJ loop",
      clip.visualMotif,
      clip.mutationNote,
      "seamless motion cycle",
      "high contrast LED wall readability"
    ].join(", "),
    negativePrompt: "humans, faces, readable text, logos, copyrighted characters, watermarks, narrative scene, hard cuts",
    loopRequirements: clip.loopRequirement,
    stageRequirements: "Readable from distance, no unsafe flicker, no small text-like artifacts.",
    qualityTargets: {
      loopScore: 80,
      stageReadability: 75,
      brightnessSafety: 70
    }
  }));
}
