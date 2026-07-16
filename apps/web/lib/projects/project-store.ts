import type { ProjectPipelineInput, ProjectPipelineResult } from "@droploop/pipeline";
import { projectSchema, reviewActionSchema, type Project, type ReviewAction } from "@droploop/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "../api-errors";
import type { BpmAnalysis } from "../media/bpm";
import type { MediaKind, MediaProbe } from "../media/ffprobe";

const projectRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  status: projectSchema.shape.status,
  template: projectSchema.shape.template,
  music_genre: z.string().nullable(),
  bpm: z.number().int().positive().nullable(),
  screen_format: projectSchema.shape.screenFormat,
  pack_size: projectSchema.shape.packSize,
  pipeline_snapshot: z.unknown(),
  bpm_analyzed: z.coerce.number().positive().nullable(),
  bpm_confidence: z.coerce.number().min(0).max(1).nullable(),
  bpm_source: z.enum(["analysis", "manual_override"]),
  bpm_analyzed_asset_id: z.string().uuid().nullable(),
  beat_grid_assumption: z.unknown(),
  created_at: z.string(),
  updated_at: z.string()
});

const clipRowSchema = z.object({
  id: z.string().uuid(),
  planned_clip_id: z.string(),
  role: z.string(),
  status: z.string(),
  loop_score: z.number().nullable(),
  quality_score: z.number().nullable(),
  duration_seconds: z.number().int().positive().nullable(),
  review_recommended_action: reviewActionSchema.nullable(),
  review_reason: z.string().nullable()
});

const jobRowSchema = z.object({
  id: z.string().uuid(),
  stage: z.string(),
  operation: z.string(),
  status: z.string(),
  progress: z.number().int(),
  created_at: z.string(),
  updated_at: z.string()
});

const reviewActionRowSchema = z.object({
  clip_id: z.string().uuid(),
  action: reviewActionSchema,
  reason: z.string().nullable(),
  created_at: z.string()
});

const reviewResultRowSchema = z.object({
  clip_id: z.string().uuid(),
  action: reviewActionSchema,
  review_status: z.enum(["approved", "rejected", "repair_requested", "regenerate_requested"]),
  clip_status: z.string(),
  reason: z.string(),
  job_id: z.string().uuid().nullable(),
  created_at: z.string()
});

const projectAssetRowSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  type: z.enum(["audio", "image", "video"]),
  role: z.enum(["source_audio", "mood_reference", "generated_output", "playable_preview"]),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.coerce.number().int().positive(),
  storage_bucket: z.string(),
  storage_path: z.string(),
  status: z.enum(["ready", "rejected"]),
  version: z.number().int().positive(),
  content_sha256: z.string().length(64),
  duration_seconds: z.number().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  frame_rate: z.number().positive().nullable(),
  codec: z.string(),
  pixel_format: z.string().nullable(),
  has_alpha: z.boolean().nullable(),
  metadata: z.unknown(),
  bpm_analyzed: z.coerce.number().positive().nullable(),
  bpm_confidence: z.coerce.number().min(0).max(1).nullable(),
  bpm_analysis_version: z.string().nullable(),
  beat_grid_assumption: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

export type PersistedClip = z.infer<typeof clipRowSchema>;
export type PersistedJob = z.infer<typeof jobRowSchema>;

export type PersistedProjectDetail = {
  project: Project;
  pipeline: ProjectPipelineResult | null;
  assets: PersistedProjectAsset[];
  clips: PersistedClip[];
  jobs: PersistedJob[];
  bpmAnalysis: {
    selectedBpm: number | null;
    selectedSource: "analysis" | "manual_override";
    analyzedBpm: number | null;
    confidence: number | null;
    analysisAssetId: string | null;
    beatGridAssumption: unknown;
  };
};

export type PersistedReview = {
  clipId: string;
  status: "pending" | "approved" | "rejected" | "repair_requested" | "regenerate_requested";
  recommendedAction: ReviewAction;
  reason: string;
};

export type AppliedReview = z.infer<typeof reviewResultRowSchema>;
export type PersistedProjectAsset = z.infer<typeof projectAssetRowSchema>;

export class SupabaseProjectStore {
  constructor(private readonly client: SupabaseClient) {}

  async listProjects(): Promise<Project[]> {
    const { data, error } = await this.client.from("projects").select("*").order("updated_at", { ascending: false });
    assertSupabaseSuccess(error, "Unable to list projects.");
    return z.array(projectRowSchema).parse(data ?? []).map(mapProject);
  }

  async listAssets(projectId: string): Promise<PersistedProjectAsset[] | null> {
    const projectResult = await this.client.from("projects").select("id").eq("id", projectId).maybeSingle();
    assertSupabaseSuccess(projectResult.error, "Unable to load the asset project.");
    if (!projectResult.data) {
      return null;
    }

    const { data, error } = await this.client
      .from("project_assets")
      .select(
        "id, project_id, type, role, filename, mime_type, size_bytes, storage_bucket, storage_path, status, version, content_sha256, duration_seconds, width, height, frame_rate, codec, pixel_format, has_alpha, metadata, bpm_analyzed, bpm_confidence, bpm_analysis_version, beat_grid_assumption, created_at, updated_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    assertSupabaseSuccess(error, "Unable to load project assets.");
    return z.array(projectAssetRowSchema).parse(data ?? []);
  }

  async registerAsset(input: {
    assetId: string;
    projectId: string;
    kind: MediaKind;
    role: "source_audio" | "mood_reference";
    storagePath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentSha256: string;
    probe: MediaProbe;
    bpmAnalysis: BpmAnalysis | null;
  }): Promise<PersistedProjectAsset> {
    const { data, error } = await this.client
      .rpc("register_project_asset", {
        p_asset_id: input.assetId,
        p_project_id: input.projectId,
        p_type: input.kind,
        p_role: input.role,
        p_storage_path: input.storagePath,
        p_filename: input.filename,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_content_sha256: input.contentSha256,
        p_duration_seconds: input.probe.durationSeconds,
        p_width: input.probe.width,
        p_height: input.probe.height,
        p_frame_rate: input.probe.frameRate,
        p_codec: input.probe.codec,
        p_pixel_format: input.probe.pixelFormat,
        p_has_alpha: input.probe.hasAlpha,
        p_metadata: { probe: input.probe, bpmAnalysis: input.bpmAnalysis }
      })
      .single();

    assertSupabaseSuccess(error, "Unable to register the uploaded asset.");
    return projectAssetRowSchema.parse(data);
  }

  async setBpmSelection(input: {
    projectId: string;
    selectedBpm: number;
    source: "analysis" | "manual_override";
    analysisAssetId?: string;
  }): Promise<Project> {
    const { data, error } = await this.client
      .rpc("set_project_bpm_selection", {
        p_project_id: input.projectId,
        p_selected_bpm: input.selectedBpm,
        p_source: input.source,
        p_analysis_asset_id: input.analysisAssetId ?? null
      })
      .single();
    assertSupabaseSuccess(error, "Unable to update the project BPM selection.");
    return mapProject(projectRowSchema.parse(data));
  }

  async createProject(
    userId: string,
    creationKey: string,
    input: ProjectPipelineInput,
    pipeline: ProjectPipelineResult
  ): Promise<Project> {
    const promptsByClipId = new Map(pipeline.prompts.map((prompt) => [prompt.clipId, prompt]));
    const reviewsByClipId = new Map(pipeline.reviewQueue.map((review) => [review.clipId, review]));
    const persistedClips = pipeline.clips.map((clip) => {
      const prompt = promptsByClipId.get(clip.clipId);
      const review = reviewsByClipId.get(clip.id);

      return {
        planned_clip_id: clip.clipId,
        role: clip.role,
        energy: prompt?.energy ?? 0,
        status: clip.status,
        preview_url: clip.previewUrl,
        thumbnail_url: clip.thumbnailUrl,
        duration_seconds: clip.durationSeconds,
        loop_score: clip.loopScore,
        quality_score: clip.qualityScore,
        review_recommended_action: review?.recommendedAction ?? "approve",
        review_reason: review?.reason ?? "Awaiting human review."
      };
    });

    const { data, error } = await this.client
      .rpc("create_project_with_clips", {
        p_project_id: input.projectId,
        p_creation_key: creationKey,
        p_name: input.projectName,
        p_template: input.template,
        p_music_genre: input.musicGenre,
        p_bpm: input.bpm,
        p_screen_format: input.screenFormat,
        p_pack_size: input.packSize,
        p_desired_mood: input.desiredMood,
        p_show_type: input.showType,
        p_pipeline_snapshot: pipeline,
        p_clips: persistedClips
      })
      .single();

    assertSupabaseSuccess(error, "Unable to persist the project workspace.");
    const project = mapProject(projectRowSchema.parse(data));

    if (project.userId !== userId) {
      throw new ApiError(403, "Persisted project owner does not match the authenticated user.", "project_owner_mismatch");
    }

    return project;
  }

  async getProject(projectId: string): Promise<PersistedProjectDetail | null> {
    const [projectResult, assetsResult, clipsResult, jobsResult] = await Promise.all([
      this.client.from("projects").select("*").eq("id", projectId).maybeSingle(),
      this.client
        .from("project_assets")
        .select(
          "id, project_id, type, role, filename, mime_type, size_bytes, storage_bucket, storage_path, status, version, content_sha256, duration_seconds, width, height, frame_rate, codec, pixel_format, has_alpha, metadata, bpm_analyzed, bpm_confidence, bpm_analysis_version, beat_grid_assumption, created_at, updated_at"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      this.client
        .from("clips")
        .select(
          "id, planned_clip_id, role, status, loop_score, quality_score, duration_seconds, review_recommended_action, review_reason"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      this.client
        .from("generation_jobs")
        .select("id, stage, operation, status, progress, created_at, updated_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
    ]);

    assertSupabaseSuccess(projectResult.error, "Unable to load the project.");
    assertSupabaseSuccess(assetsResult.error, "Unable to load project assets.");
    assertSupabaseSuccess(clipsResult.error, "Unable to load project clips.");
    assertSupabaseSuccess(jobsResult.error, "Unable to load project jobs.");

    if (!projectResult.data) {
      return null;
    }

    const row = projectRowSchema.parse(projectResult.data);
    const pipeline = isPipelineSnapshot(row.pipeline_snapshot) ? row.pipeline_snapshot : null;
    return {
      project: mapProject(row),
      pipeline,
      assets: z.array(projectAssetRowSchema).parse(assetsResult.data ?? []),
      clips: z.array(clipRowSchema).parse(clipsResult.data ?? []),
      jobs: z.array(jobRowSchema).parse(jobsResult.data ?? []),
      bpmAnalysis: {
        selectedBpm: row.bpm,
        selectedSource: row.bpm_source,
        analyzedBpm: row.bpm_analyzed,
        confidence: row.bpm_confidence,
        analysisAssetId: row.bpm_analyzed_asset_id,
        beatGridAssumption: row.beat_grid_assumption
      }
    };
  }

  async listReviews(projectId: string): Promise<{ reviews: PersistedReview[]; clips: PersistedClip[] } | null> {
    const projectResult = await this.client.from("projects").select("id").eq("id", projectId).maybeSingle();
    assertSupabaseSuccess(projectResult.error, "Unable to load the review project.");

    if (!projectResult.data) {
      return null;
    }

    const [clipsResult, actionsResult] = await Promise.all([
      this.client
        .from("clips")
        .select(
          "id, planned_clip_id, role, status, loop_score, quality_score, duration_seconds, review_recommended_action, review_reason"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      this.client
        .from("review_actions")
        .select("clip_id, action, reason, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
    ]);

    assertSupabaseSuccess(clipsResult.error, "Unable to load review clips.");
    assertSupabaseSuccess(actionsResult.error, "Unable to load review history.");

    const clips = z.array(clipRowSchema).parse(clipsResult.data ?? []);
    const actions = z.array(reviewActionRowSchema).parse(actionsResult.data ?? []);
    const latestByClip = new Map<string, z.infer<typeof reviewActionRowSchema>>();
    actions.forEach((action) => {
      if (!latestByClip.has(action.clip_id)) {
        latestByClip.set(action.clip_id, action);
      }
    });

    return {
      clips,
      reviews: clips.map((clip) => {
        const latest = latestByClip.get(clip.id);
        return {
          clipId: clip.id,
          status: latest ? mapReviewStatus(latest.action) : "pending",
          recommendedAction: clip.review_recommended_action ?? "approve",
          reason: latest?.reason ?? clip.review_reason ?? "Awaiting human review."
        };
      })
    };
  }

  async applyReview(input: {
    projectId: string;
    clipId: string;
    action: ReviewAction;
    reason?: string;
    idempotencyKey: string;
  }): Promise<AppliedReview> {
    const { data, error } = await this.client
      .rpc("apply_clip_review_action", {
        p_project_id: input.projectId,
        p_clip_id: input.clipId,
        p_action: input.action,
        p_reason: input.reason ?? "",
        p_idempotency_key: input.idempotencyKey
      })
      .single();

    assertSupabaseSuccess(error, "Unable to apply the review action.");
    return reviewResultRowSchema.parse(data);
  }
}

function assertSupabaseSuccess(error: { message: string; code?: string } | null, message: string): asserts error is null {
  if (!error) {
    return;
  }

  const status = {
    PGRST116: 404,
    P0002: 404,
    "42501": 403,
    "23505": 409
  }[error.code ?? ""] ?? 502;
  throw new ApiError(status, message, error.code ?? "supabase_data_error");
}

function mapProject(row: z.infer<typeof projectRowSchema>): Project {
  return projectSchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    template: row.template,
    musicGenre: row.music_genre ?? undefined,
    bpm: row.bpm ?? undefined,
    screenFormat: row.screen_format,
    packSize: row.pack_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapReviewStatus(action: ReviewAction): PersistedReview["status"] {
  return {
    approve: "approved",
    reject: "rejected",
    repair: "repair_requested",
    regenerate: "regenerate_requested"
  }[action] as PersistedReview["status"];
}

function isPipelineSnapshot(value: unknown): value is ProjectPipelineResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Boolean(candidate.brief && Array.isArray(candidate.clips) && Array.isArray(candidate.stageResults));
}
