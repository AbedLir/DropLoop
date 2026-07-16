export type PipelineResponse = {
  project: {
    id: string;
    name: string;
    status: string;
  };
  pipeline: {
    brief: {
      projectName: string;
      musicGenre: string;
      bpm: number;
      showType: string;
      desiredMood: string;
      outputGoal: string;
    };
    referenceAssets: Array<{
      id: string;
      type: string;
      filename: string;
      description: string;
      rightsStatus: string;
      detectedRisk: string;
    }>;
    recipes: Array<{
      id: string;
      label: string;
      purpose: string;
      inputRoles: string[];
      outputRoles: string[];
      status: string;
      progress: number;
      summary: string;
    }>;
    agentEvents: AgentMessage[];
    assetClassifications: Array<{
      id: string;
      role: string;
      visualRole?: string;
      label: string;
      format: string;
      exportable: boolean;
      tags: string[];
      usage: string;
      rightsStatus?: string;
      playback?: {
        codecTarget: string;
        frameRate: number;
        resolution: string;
        loopDurationSeconds: number;
        alphaSupport: string;
      };
    }>;
    canvas: {
      nodes: Array<{
        id: string;
        type: string;
        title: string;
        subtitle: string;
        status: string;
        x: number;
        y: number;
        width: number;
        height: number;
        assetIds: string[];
      }>;
    };
    clips: Array<{
      id: string;
      clipId: string;
      role: string;
      loopScore: number;
      qualityScore: number;
      durationSeconds: number;
    }>;
    stagePreview: {
      screenFormat: string;
      surfaces: string[];
      stageReadability: number;
      brightnessSafety: number;
      contrastScore: number;
      safeMargins: string;
      safeViewingDistance: string;
    };
    safetyReport: {
      commercialUsageRisk: string;
      flickerRisk: number;
      ownershipRisk: number;
      notes: string[];
    };
    exportManifest: {
      preset: string;
      approvedClipIds: string[];
      folders: string[];
    };
  };
  assets?: UploadedAsset[];
};

export type UploadedAsset = {
  id: string;
  type: "audio" | "image" | "video";
  role: "source_audio" | "mood_reference";
  filename: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_rate: number | null;
  codec: string;
  pixel_format: string | null;
  has_alpha: boolean | null;
  bpm_analyzed: number | null;
  bpm_confidence: number | null;
  bpm_analysis_version: string | null;
  beat_grid_assumption: string | null;
};

export type AgentMessage = {
  id: string;
  role: "agent" | "user" | "system";
  title: string;
  body: string;
  bullets?: string[];
  status?: "idle" | "running" | "completed" | "blocked";
};
