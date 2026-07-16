import { buildClipPrompts } from "@droploop/prompts";
import {
  agentEventSchema,
  assetInsightSchema,
  clipReviewSchema,
  energyMapSchema,
  exportManifestSchema,
  generatedClipSchema,
  packPlanSchema,
  pipelineStageResultSchema,
  projectBriefSchema,
  projectTemplateSchema,
  qualityScoreSchema,
  referenceAssetSchema,
  safetyReportSchema,
  screenFormatSchema,
  stagePreviewSchema,
  visualDnaSchema
} from "@droploop/schemas";
import type {
  AgentEvent,
  AssetInsight,
  AssetClassification,
  CanvasModel,
  ClipPrompt,
  ClipReview,
  EnergyMap,
  ExportManifest,
  GeneratedClip,
  PackPlan,
  PipelineStageResult,
  ProjectBrief,
  QualityScore,
  ReferenceAsset,
  SafetyReport,
  StagePreview,
  VjRecipe,
  VisualDna
} from "@droploop/schemas";
import { z } from "zod";
import { classifyVjAssets } from "./asset-classifier";
import { buildCanvasModel } from "./canvas-model";
export { buildExportPresetDetail } from "./export-manifest";
import { evaluateClipGate } from "./quality-gates";
export { evaluateClipGate } from "./quality-gates";
import { buildVjRecipeCatalog } from "./recipes";
export { classifyVjAssets } from "./asset-classifier";
export { buildCanvasModel } from "./canvas-model";
export { buildVjRecipeCatalog } from "./recipes";
export {
  DurableJobController,
  InvalidJobTransitionError,
  JobConflictError,
  ProviderError,
  assertJobTransition,
  assertReserveJobTopology,
  canTransitionJob
} from "./control-plane";
export type {
  CreateAttemptInput,
  DurableJobRepository,
  GenerateVideoInput,
  JobChanges,
  RegisteredProviderOutput,
  RegisterProviderOutputInput,
  RepairVideoInput,
  ReserveJobInput,
  VideoProvider
} from "./control-plane";

export const projectPipelineInputSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  template: projectTemplateSchema,
  musicGenre: z.string().min(1),
  bpm: z.number().int().min(40).max(240),
  showType: z.string().min(1),
  screenFormat: screenFormatSchema,
  packSize: z.union([z.literal(12), z.literal(30), z.literal(60)]),
  desiredMood: z.string().min(1),
  references: z.array(z.string()).default([])
});

export type ProjectPipelineInput = z.infer<typeof projectPipelineInputSchema>;

export type ProjectPipelineResult = {
  brief: ProjectBrief;
  referenceAssets: ReferenceAsset[];
  assetInsight: AssetInsight;
  visualDna: VisualDna;
  energyMap: EnergyMap;
  packPlan: PackPlan;
  prompts: ClipPrompt[];
  clips: GeneratedClip[];
  qualityScores: Record<string, QualityScore>;
  exportManifest: ExportManifest;
  recipes: VjRecipe[];
  agentEvents: AgentEvent[];
  assetClassifications: AssetClassification[];
  canvas: CanvasModel;
  stageResults: PipelineStageResult[];
  stagePreview: StagePreview;
  safetyReport: SafetyReport;
  reviewQueue: ClipReview[];
};

export async function runProjectMockPipeline(input: ProjectPipelineInput): Promise<ProjectPipelineResult> {
  const normalized = projectPipelineInputSchema.parse(input);
  const brief = createProjectBrief(normalized);
  const referenceAssets = createReferenceAssets(normalized);
  const assetInsight = createAssetInsight(normalized);
  const visualDna = createVisualDna(brief, assetInsight);
  const energyMap = createEnergyMap(brief, assetInsight);
  const packPlan = createPackPlan(normalized, energyMap);
  const prompts = buildClipPrompts(packPlan);
  const clips = prompts.map((prompt) => createGeneratedClip(normalized.projectId, prompt));
  const qualityScores = Object.fromEntries(clips.map((clip) => [clip.id, createQualityScore(clip)]));
  const exportManifest = createExportManifest(normalized.projectId, clips);
  const recipes = buildVjRecipeCatalog();
  const agentEvents = createAgentEvents(recipes);
  const assetClassifications = classifyVjAssets(normalized.projectId, referenceAssets, clips);
  const canvas = buildCanvasModel(normalized.projectId, recipes, assetClassifications);
  const stageResults = createStageResults();
  const stagePreview = createStagePreview(brief);
  const safetyReport = createSafetyReport(assetInsight);
  const reviewQueue = createReviewQueue(clips, qualityScores, stagePreview, safetyReport);

  return {
    brief,
    referenceAssets,
    assetInsight,
    visualDna,
    energyMap,
    packPlan,
    prompts,
    clips,
    qualityScores,
    exportManifest,
    recipes,
    agentEvents,
    assetClassifications,
    canvas,
    stageResults,
    stagePreview,
    safetyReport,
    reviewQueue
  };
}

export async function createDemoWorkspace(): Promise<ProjectPipelineResult> {
  return runProjectMockPipeline({
    projectId: "demo",
    projectName: "Warehouse Techno Night",
    template: "club_night",
    musicGenre: "warehouse techno",
    bpm: 132,
    showType: "club LED wall",
    screenFormat: "16:9",
    packSize: 12,
    desiredMood: "industrial strobes, steel tunnels, red haze",
    references: ["red haze moodboard", "wide LED wall", "DJ booth strip"]
  });
}

function createProjectBrief(input: ProjectPipelineInput): ProjectBrief {
  return projectBriefSchema.parse({
    projectName: input.projectName,
    musicGenre: input.musicGenre,
    bpm: input.bpm,
    showType: input.showType,
    screenFormat: input.screenFormat,
    desiredMood: input.desiredMood,
    forbiddenElements: ["humans", "faces", "readable text", "random logos", "copyrighted characters"],
    packSize: input.packSize,
    outputGoal: `${input.showType} stage-ready VJ pack`,
    uncertaintyFields: input.references.length === 0 ? ["references"] : []
  });
}

function createAssetInsight(input: ProjectPipelineInput): AssetInsight {
  return assetInsightSchema.parse({
    dominantColors: extractColorHints(input.desiredMood),
    visualMotifs: extractMotifs(input.desiredMood, input.references),
    textureLanguage: ["stage haze", "high contrast surfaces", "LED-readable texture"],
    motionLanguage: ["loopable pulse", "controlled rhythmic expansion"],
    logoDetected: input.references.some((reference) => reference.toLowerCase().includes("logo")),
    copyrightRisk: "low",
    usableReferenceStrength: input.references.length > 0 ? 82 : 54,
    summary: "Mock asset intelligence converted project mood and references into reusable creative signals."
  });
}

function createReferenceAssets(input: ProjectPipelineInput): ReferenceAsset[] {
  const audioAsset = referenceAssetSchema.parse({
    id: `${input.projectId}-audio`,
    type: "audio",
    filename: `${input.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.wav`,
    mimeType: "audio/wav",
    sizeBytes: 48_000_000,
    description: `${input.musicGenre} reference at ${input.bpm} BPM`,
    rightsStatus: "user_owned",
    detectedRisk: "low"
  });

  const referenceAssets = input.references.map((reference, index) =>
    referenceAssetSchema.parse({
      id: `${input.projectId}-reference-${index + 1}`,
      type: reference.toLowerCase().includes("logo") ? "logo" : "moodboard",
      filename: `reference-${index + 1}.txt`,
      mimeType: "text/plain",
      sizeBytes: reference.length,
      description: reference,
      rightsStatus: "unknown",
      detectedRisk: reference.toLowerCase().includes("logo") ? "medium" : "low"
    })
  );

  return [audioAsset, ...referenceAssets];
}

function createVisualDna(brief: ProjectBrief, assetInsight: AssetInsight): VisualDna {
  return visualDnaSchema.parse({
    styleDna: { positioning: "professional VJ pack", genre: brief.musicGenre },
    colorDna: { palette: assetInsight.dominantColors },
    textureDna: { materials: assetInsight.textureLanguage },
    motionDna: { behavior: assetInsight.motionLanguage },
    cameraDna: { behavior: "symmetrical stage-readable motion" },
    stageDna: { format: brief.screenFormat, readability: "high contrast from distance" },
    negativeDna: { avoid: brief.forbiddenElements },
    lockedTraits: assetInsight.visualMotifs.slice(0, 3),
    flexibleTraits: ["density", "pulse speed", "camera depth", "brightness contour"],
    mutationRules: { perClip: "keep locked traits; mutate one flexible trait per clip" }
  });
}

function createEnergyMap(brief: ProjectBrief, assetInsight: AssetInsight): EnergyMap {
  return energyMapSchema.parse({
    bpm: brief.bpm,
    sections: [
      {
        id: "ambient-1",
        section: "ambient",
        energy: 35,
        visualRole: "ambient",
        motionSpeed: "slow",
        brightness: "low",
        density: "sparse",
        cameraBehavior: "slow drift",
        recommendedClipCount: 3,
        suitableMotifs: assetInsight.visualMotifs.slice(0, 2),
        forbiddenVisualBehavior: ["hard cuts", "unsafe strobe"]
      },
      {
        id: "groove-1",
        section: "groove",
        energy: 58,
        visualRole: "groove",
        motionSpeed: "medium pulse",
        brightness: "medium",
        density: "layered",
        cameraBehavior: "locked rhythmic push",
        recommendedClipCount: 3,
        suitableMotifs: assetInsight.visualMotifs,
        forbiddenVisualBehavior: ["narrative scene", "readable text"]
      },
      {
        id: "drop-1",
        section: "drop",
        energy: 92,
        visualRole: "drop",
        motionSpeed: "fast pulse",
        brightness: "high",
        density: "dense",
        cameraBehavior: "expanding impact",
        recommendedClipCount: 4,
        suitableMotifs: assetInsight.visualMotifs,
        forbiddenVisualBehavior: ["faces", "logos", "watermarks"]
      }
    ]
  });
}

function createPackPlan(input: ProjectPipelineInput, energyMap: EnergyMap): PackPlan {
  const base = energyMap.sections.map((section, index) => ({
    clipId: `${section.visualRole}-${index + 1}`,
    category: section.visualRole,
    energy: section.energy,
    durationSeconds: 8 as const,
    purpose: `${section.visualRole} clip for ${input.showType}`,
    visualMotif: section.suitableMotifs[0] ?? input.desiredMood,
    mutationNote: `${section.cameraBehavior}, ${section.motionSpeed}, ${section.density}`,
    loopRequirement: "first and last frames match with no brightness jump",
    exportPriority: section.energy >= 80 ? ("high" as const) : ("medium" as const)
  }));

  return packPlanSchema.parse({
    clips: base.slice(0, Math.min(input.packSize, base.length))
  });
}

function createGeneratedClip(projectId: string, prompt: ClipPrompt): GeneratedClip {
  return generatedClipSchema.parse({
    id: `mock-${projectId}-${prompt.clipId}`,
    clipId: prompt.clipId,
    role: prompt.role,
    status: "generated",
    previewUrl: `/mock/clips/${prompt.clipId}.mp4`,
    thumbnailUrl: `/mock/thumbnails/${prompt.clipId}.jpg`,
    durationSeconds: prompt.durationSeconds,
    loopScore: Math.min(96, 72 + Math.round(prompt.energy / 5)),
    qualityScore: Math.min(96, 74 + Math.round(prompt.energy / 6))
  });
}

function createQualityScore(clip: GeneratedClip): QualityScore {
  return qualityScoreSchema.parse({
    loopContinuity: clip.loopScore,
    motionStability: 84,
    stageReadability: clip.role === "drop" ? 91 : 82,
    styleConsistency: 90,
    energyMatch: clip.qualityScore,
    artifactRisk: 8,
    textLogoFaceRisk: 0,
    brightnessSafety: 78,
    decision: clip.loopScore >= 80 ? "use_directly" : "repair"
  });
}

function createExportManifest(projectId: string, clips: GeneratedClip[]): ExportManifest {
  return exportManifestSchema.parse({
    projectId,
    preset: "resolume",
    folders: ["01_Ambient", "02_Groove", "04_Drop", "08_Thumbnails", "09_Resolume"],
    approvedClipIds: clips.filter((clip) => clip.loopScore >= 80).map((clip) => clip.id),
    includesSafetyReport: true,
    includesThumbnails: true
  });
}

function createAgentEvents(recipes: VjRecipe[]): AgentEvent[] {
  return [
    agentEventSchema.parse({
      id: "agent-start",
      role: "agent",
      title: "DROPLOOP Agent initialized",
      body: "I will turn the DJ set context into a structured VJ pack with energy map, Visual DNA, loops, stage preview, and export notes.",
      bullets: ["Loop-first workflow", "No faces or readable text by default", "Operator handoff included"],
      status: "completed"
    }),
    ...recipes.map((recipe) =>
      agentEventSchema.parse({
        id: `agent-${recipe.id}`,
        recipeId: recipe.id,
        role: "system",
        title: recipe.label,
        body: recipe.summary,
        bullets: [`Inputs: ${recipe.inputRoles.join(", ")}`, `Outputs: ${recipe.outputRoles.join(", ")}`],
        status: "completed"
      })
    )
  ];
}

function createStageResults(): PipelineStageResult[] {
  return [
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
  ].map((stage) =>
    pipelineStageResultSchema.parse({
      stage,
      status: "completed",
      progress: 100,
      summary: `${stage.replaceAll("_", " ")} completed for deterministic MVP workspace.`
    })
  );
}

function createStagePreview(brief: ProjectBrief): StagePreview {
  return stagePreviewSchema.parse({
    screenFormat: brief.screenFormat,
    surfaces: ["led_wall", "dj_booth_strip", "client_preview"],
    stageReadability: 84,
    brightnessSafety: 78,
    contrastScore: 86,
    safeMargins: "Keep critical motion and logo-safe areas inside 8% screen margin.",
    safeViewingDistance: "Readable from dance floor, FOH, and balcony sightlines.",
    notes: ["High contrast composition", "No small readable text", "Drop clips reserve brightness headroom"]
  });
}

function createSafetyReport(assetInsight: AssetInsight): SafetyReport {
  return safetyReportSchema.parse({
    copyrightedCharacterRisk: 0,
    celebrityLikenessRisk: 0,
    unauthorizedBrandRisk: assetInsight.logoDetected ? 35 : 0,
    readableTextRisk: 0,
    watermarkRisk: 0,
    flickerRisk: 12,
    ownershipRisk: assetInsight.copyrightRisk === "high" ? 70 : assetInsight.copyrightRisk === "medium" ? 35 : 8,
    commercialUsageRisk: assetInsight.copyrightRisk,
    notes: ["Mock report checks prompts and reference metadata, not real pixels."]
  });
}

function createReviewQueue(
  clips: GeneratedClip[],
  qualityScores: Record<string, QualityScore>,
  stagePreview: StagePreview,
  safetyReport: SafetyReport
): ClipReview[] {
  return clips.map((clip) => {
    const quality = qualityScores[clip.id];

    if (!quality) {
      throw new Error(`Missing quality score for clip ${clip.id}`);
    }

    const gate = evaluateClipGate(clip, quality, stagePreview, safetyReport);

    return clipReviewSchema.parse({
      clipId: clip.id,
      status: gate.approved ? "approved" : gate.recommendedAction === "repair" ? "repair_requested" : "regenerate_requested",
      recommendedAction: gate.recommendedAction,
      reason: gate.reasons.length > 0 ? gate.reasons.join("; ") : "Passes MVP export gates."
    });
  });
}

function extractColorHints(text: string): string[] {
  const lowered = text.toLowerCase();
  const colors = ["black", "red", "blue", "white", "violet", "chrome", "steel"].filter((color) => lowered.includes(color));
  return colors.length > 0 ? colors : ["black", "laser blue", "cold white"];
}

function extractMotifs(mood: string, references: string[]): string[] {
  const words = `${mood} ${references.join(" ")}`
    .split(/[,\s]+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 4);
  const unique = Array.from(new Set(words)).slice(0, 5);
  return unique.length > 0 ? unique : ["abstract tunnel", "stage haze", "LED grid"];
}
