import { assetClassificationSchema } from "@droploop/schemas";
import type { AssetClassification, GeneratedClip, ReferenceAsset, VjVisualRole } from "@droploop/schemas";

function roleForClip(clip: GeneratedClip): VjVisualRole {
  if (clip.role === "drop") return "drop_hit";
  if (clip.role === "groove") return "groove_loop";
  if (clip.role === "transition") return "transition";
  if (clip.role === "logo_identity") return "logo_safe_background";
  return "ambient_bed";
}

export function classifyVjAssets(projectId: string, references: ReferenceAsset[], clips: GeneratedClip[]): AssetClassification[] {
  const sourceAssets = references.map((reference) =>
    assetClassificationSchema.parse({
      id: reference.id,
      role: reference.type === "audio" ? "source_audio" : "mood_reference",
      label: reference.filename,
      source: "user_input",
      format: reference.mimeType,
      exportable: reference.type !== "audio",
      tags: [reference.type, reference.rightsStatus, reference.detectedRisk],
      usage: reference.type === "audio" ? "Analyze BPM and energy structure." : "Guide visual DNA and styleframe direction.",
      rightsStatus: reference.rightsStatus
    })
  );

  const loopAssets = clips.flatMap((clip) => [
    assetClassificationSchema.parse({
      id: `${clip.id}-video`,
      role: "vj_loop",
      visualRole: roleForClip(clip),
      label: `${clip.clipId}.mp4`,
      source: "mock_provider",
      format: "video/mp4",
      exportable: clip.loopScore >= 80,
      tags: [clip.role, `loop-${clip.loopScore}`, `quality-${clip.qualityScore}`],
      usage: "Live VJ loop candidate for deck import.",
      rightsStatus: "generated",
      playback: {
        codecTarget: "mock",
        frameRate: 30,
        resolution: "1920x1080",
        loopDurationSeconds: clip.durationSeconds,
        alphaSupport: "none",
        namingConvention: "{role}_{energy}_{bpm}_{version}",
        operatorNotes: ["Mock media placeholder; validate real codec before live playback."]
      }
    }),
    assetClassificationSchema.parse({
      id: `${clip.id}-thumb`,
      role: "thumbnail",
      visualRole: roleForClip(clip),
      label: `${clip.clipId}.jpg`,
      source: "mock_provider",
      format: "image/jpeg",
      exportable: true,
      tags: [clip.role, "contact-sheet"],
      usage: "Thumbnail for review sheet and operator navigation.",
      rightsStatus: "generated"
    })
  ]);

  return [
    ...sourceAssets,
    assetClassificationSchema.parse({
      id: `${projectId}-visual-dna`,
      role: "visual_dna",
      label: "visual-dna.json",
      source: "recipe_output",
      format: "application/json",
      exportable: true,
      tags: ["style", "rules", "negative-prompts"],
      usage: "Stable style contract for all generated pack assets.",
      rightsStatus: "generated"
    }),
    ...loopAssets,
    assetClassificationSchema.parse({
      id: `${projectId}-safety-report`,
      role: "safety_report",
      label: "safety-report.json",
      source: "system_report",
      format: "application/json",
      exportable: true,
      tags: ["rights", "flicker", "commercial-use"],
      usage: "Operator and client safety review.",
      rightsStatus: "generated"
    }),
    assetClassificationSchema.parse({
      id: `${projectId}-export-manifest`,
      role: "export_manifest",
      label: "manifest.json",
      source: "system_report",
      format: "application/json",
      exportable: true,
      tags: ["folders", "presets", "handoff"],
      usage: "Folder and file plan for VJ software handoff.",
      rightsStatus: "generated"
    })
  ];
}
