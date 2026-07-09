import { z } from "zod";

export const projectTemplateSchema = z.enum([
  "club_night",
  "festival_mainstage",
  "touring_dj_support",
  "brand_launch",
  "client_preview",
  "dj_booth_strip",
  "club",
  "festival",
  "tour",
  "brand_event",
  "visualizer",
  "projection_mapping"
]);

export const screenFormatSchema = z.enum(["16:9", "21:9", "32:9", "9:16", "1:1", "custom"]);
export const clipRoleSchema = z.enum(["ambient", "groove", "build", "drop", "transition", "logo_identity"]);
export const jobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

export const pipelineStageSchema = z.enum([
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

export const vjRecipeIdSchema = z.enum([
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

export const vjVisualRoleSchema = z.enum([
  "opener",
  "ambient_bed",
  "groove_loop",
  "drop_hit",
  "transition",
  "stinger",
  "closer",
  "logo_safe_background",
  "blackout_safe_loop"
]);

export const showTemplateSchema = z.enum(["club_night", "festival_mainstage", "brand_launch", "touring_dj_support"]);

export const screenSurfaceSchema = z.enum([
  "led_wall",
  "dj_booth_strip",
  "portrait_side_screen",
  "square_social_crop",
  "client_preview"
]);

export const rightsStatusSchema = z.enum(["user_owned", "licensed", "generated", "unknown", "restricted_use"]);

export const playbackMetadataSchema = z.object({
  codecTarget: z.enum(["h264", "hap", "prores", "png_sequence", "mock"]),
  frameRate: z.number().positive(),
  resolution: z.string(),
  loopDurationSeconds: z.number().positive(),
  alphaSupport: z.enum(["none", "straight_alpha", "premultiplied_alpha", "unknown"]),
  namingConvention: z.string(),
  operatorNotes: z.array(z.string())
});

export const projectSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  status: z.enum(["draft", "analyzing", "planning", "generating", "reviewing", "exported", "failed"]),
  template: projectTemplateSchema,
  musicGenre: z.string().optional(),
  bpm: z.number().int().positive().optional(),
  screenFormat: screenFormatSchema,
  customWidth: z.number().int().positive().optional(),
  customHeight: z.number().int().positive().optional(),
  packSize: z.union([z.literal(12), z.literal(30), z.literal(60)]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const projectBriefSchema = z.object({
  projectName: z.string(),
  musicGenre: z.string(),
  bpm: z.number().int().positive(),
  showType: z.string(),
  screenFormat: screenFormatSchema,
  desiredMood: z.string(),
  forbiddenElements: z.array(z.string()),
  packSize: z.union([z.literal(12), z.literal(30), z.literal(60)]),
  outputGoal: z.string(),
  uncertaintyFields: z.array(z.string())
});

export const assetInsightSchema = z.object({
  dominantColors: z.array(z.string()),
  visualMotifs: z.array(z.string()),
  textureLanguage: z.array(z.string()),
  motionLanguage: z.array(z.string()),
  logoDetected: z.boolean(),
  copyrightRisk: z.enum(["low", "medium", "high"]),
  usableReferenceStrength: z.number().min(0).max(100),
  summary: z.string()
});

export const visualDnaSchema = z.object({
  styleDna: z.record(z.unknown()),
  colorDna: z.record(z.unknown()),
  textureDna: z.record(z.unknown()),
  motionDna: z.record(z.unknown()),
  cameraDna: z.record(z.unknown()),
  stageDna: z.record(z.unknown()),
  negativeDna: z.record(z.unknown()),
  lockedTraits: z.array(z.string()),
  flexibleTraits: z.array(z.string()),
  mutationRules: z.record(z.unknown())
});

export const energySectionSchema = z.object({
  id: z.string(),
  section: z.enum(["intro", "ambient", "groove", "build_up", "drop", "breakdown", "peak", "outro"]),
  energy: z.number().min(0).max(100),
  visualRole: clipRoleSchema,
  motionSpeed: z.string(),
  brightness: z.string(),
  density: z.string(),
  cameraBehavior: z.string(),
  recommendedClipCount: z.number().int().min(1),
  suitableMotifs: z.array(z.string()),
  forbiddenVisualBehavior: z.array(z.string())
});

export const energyMapSchema = z.object({
  bpm: z.number().int().positive(),
  sections: z.array(energySectionSchema).min(1)
});

export const plannedClipSchema = z.object({
  clipId: z.string(),
  category: clipRoleSchema,
  energy: z.number().min(0).max(100),
  durationSeconds: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  purpose: z.string(),
  visualMotif: z.string(),
  mutationNote: z.string(),
  loopRequirement: z.string(),
  exportPriority: z.enum(["low", "medium", "high"])
});

export const packPlanSchema = z.object({
  clips: z.array(plannedClipSchema).min(1)
});

export const clipPromptSchema = z.object({
  clipId: z.string(),
  role: clipRoleSchema,
  durationSeconds: z.number().int().positive(),
  energy: z.number().min(0).max(100),
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  loopRequirements: z.string(),
  stageRequirements: z.string(),
  qualityTargets: z.record(z.unknown())
});

export const generatedClipSchema = z.object({
  id: z.string(),
  clipId: z.string(),
  role: clipRoleSchema,
  status: z.enum(["planned", "queued", "generating", "generated", "repairing", "approved", "rejected", "exported"]),
  previewUrl: z.string(),
  thumbnailUrl: z.string(),
  durationSeconds: z.number().int().positive(),
  loopScore: z.number().min(0).max(100),
  qualityScore: z.number().min(0).max(100)
});

export const qualityScoreSchema = z.object({
  loopContinuity: z.number().min(0).max(100),
  motionStability: z.number().min(0).max(100),
  stageReadability: z.number().min(0).max(100),
  styleConsistency: z.number().min(0).max(100),
  energyMatch: z.number().min(0).max(100),
  artifactRisk: z.number().min(0).max(100),
  textLogoFaceRisk: z.number().min(0).max(100),
  brightnessSafety: z.number().min(0).max(100),
  decision: z.enum(["use_directly", "repair", "regenerate"])
});

export const exportManifestSchema = z.object({
  projectId: z.string(),
  preset: z.enum(["resolume", "madmapper", "touchdesigner", "led_wall", "social", "client_review"]),
  folders: z.array(z.string()),
  approvedClipIds: z.array(z.string()),
  includesSafetyReport: z.boolean(),
  includesThumbnails: z.boolean()
});

export const pipelineStageResultSchema = z.object({
  stage: pipelineStageSchema,
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  summary: z.string(),
  errorMessage: z.string().optional()
});

export const vjRecipeSchema = z.object({
  id: vjRecipeIdSchema,
  label: z.string(),
  purpose: z.string(),
  inputRoles: z.array(z.string()),
  outputRoles: z.array(z.string()),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  summary: z.string()
});

export const agentEventSchema = z.object({
  id: z.string(),
  recipeId: vjRecipeIdSchema.optional(),
  role: z.enum(["agent", "user", "system"]),
  title: z.string(),
  body: z.string(),
  bullets: z.array(z.string()).default([]),
  status: z.enum(["idle", "running", "completed", "blocked"])
});

export const referenceAssetSchema = z.object({
  id: z.string(),
  type: z.enum(["audio", "image", "video", "moodboard", "logo", "text_note"]),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  description: z.string(),
  rightsStatus: rightsStatusSchema,
  detectedRisk: z.enum(["low", "medium", "high"])
});

export const assetRoleSchema = z.enum([
  "source_audio",
  "mood_reference",
  "visual_dna",
  "styleframe",
  "vj_loop",
  "thumbnail",
  "stage_preview",
  "safety_report",
  "export_manifest"
]);

export const assetClassificationSchema = z.object({
  id: z.string(),
  role: assetRoleSchema,
  visualRole: vjVisualRoleSchema.optional(),
  label: z.string(),
  source: z.enum(["user_input", "recipe_output", "mock_provider", "system_report"]),
  format: z.string(),
  exportable: z.boolean(),
  tags: z.array(z.string()),
  usage: z.string(),
  rightsStatus: rightsStatusSchema.optional(),
  playback: playbackMetadataSchema.optional()
});

export const canvasNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["brief", "audio", "recipe", "visual_dna", "styleframe", "vj_loop", "stage_preview", "export_pack"]),
  title: z.string(),
  subtitle: z.string(),
  status: z.enum(["ready", "running", "completed", "blocked"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  assetIds: z.array(z.string()).default([])
});

export const canvasEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string()
});

export const canvasModelSchema = z.object({
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema)
});

export const stagePreviewSchema = z.object({
  screenFormat: screenFormatSchema,
  surfaces: z.array(screenSurfaceSchema),
  stageReadability: z.number().min(0).max(100),
  brightnessSafety: z.number().min(0).max(100),
  contrastScore: z.number().min(0).max(100),
  safeMargins: z.string(),
  safeViewingDistance: z.string(),
  notes: z.array(z.string())
});

export const safetyReportSchema = z.object({
  copyrightedCharacterRisk: z.number().min(0).max(100),
  celebrityLikenessRisk: z.number().min(0).max(100),
  unauthorizedBrandRisk: z.number().min(0).max(100),
  readableTextRisk: z.number().min(0).max(100),
  watermarkRisk: z.number().min(0).max(100),
  flickerRisk: z.number().min(0).max(100),
  ownershipRisk: z.number().min(0).max(100),
  commercialUsageRisk: z.enum(["low", "medium", "high"]),
  notes: z.array(z.string())
});

export const reviewActionSchema = z.enum(["approve", "reject", "repair", "regenerate"]);

export const clipReviewSchema = z.object({
  clipId: z.string(),
  status: z.enum(["pending", "approved", "rejected", "repair_requested", "regenerate_requested"]),
  recommendedAction: reviewActionSchema,
  reason: z.string()
});

export const exportPresetDetailSchema = z.object({
  preset: exportManifestSchema.shape.preset,
  label: z.string(),
  folders: z.array(z.string()),
  requiredFiles: z.array(z.string()),
  playback: playbackMetadataSchema,
  handoffNotes: z.array(z.string()),
  notes: z.array(z.string())
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectBrief = z.infer<typeof projectBriefSchema>;
export type AssetInsight = z.infer<typeof assetInsightSchema>;
export type VisualDna = z.infer<typeof visualDnaSchema>;
export type EnergyMap = z.infer<typeof energyMapSchema>;
export type PlannedClip = z.infer<typeof plannedClipSchema>;
export type PackPlan = z.infer<typeof packPlanSchema>;
export type ClipPrompt = z.infer<typeof clipPromptSchema>;
export type GeneratedClip = z.infer<typeof generatedClipSchema>;
export type QualityScore = z.infer<typeof qualityScoreSchema>;
export type ExportManifest = z.infer<typeof exportManifestSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type PipelineStageResult = z.infer<typeof pipelineStageResultSchema>;
export type VjRecipeId = z.infer<typeof vjRecipeIdSchema>;
export type VjRecipe = z.infer<typeof vjRecipeSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type VjVisualRole = z.infer<typeof vjVisualRoleSchema>;
export type ShowTemplate = z.infer<typeof showTemplateSchema>;
export type ScreenSurface = z.infer<typeof screenSurfaceSchema>;
export type RightsStatus = z.infer<typeof rightsStatusSchema>;
export type PlaybackMetadata = z.infer<typeof playbackMetadataSchema>;
export type ReferenceAsset = z.infer<typeof referenceAssetSchema>;
export type AssetRole = z.infer<typeof assetRoleSchema>;
export type AssetClassification = z.infer<typeof assetClassificationSchema>;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasModel = z.infer<typeof canvasModelSchema>;
export type StagePreview = z.infer<typeof stagePreviewSchema>;
export type SafetyReport = z.infer<typeof safetyReportSchema>;
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export type ClipReview = z.infer<typeof clipReviewSchema>;
export type ExportPresetDetail = z.infer<typeof exportPresetDetailSchema>;
