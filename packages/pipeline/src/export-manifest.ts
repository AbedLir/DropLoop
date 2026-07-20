import { exportPresetDetailSchema } from "@droploop/schemas";
import type { ExportManifest, ExportPresetDetail } from "@droploop/schemas";

const defaultPlayback = {
  codecTarget: "mock",
  frameRate: 30,
  resolution: "1920x1080",
  loopDurationSeconds: 12,
  alphaSupport: "none",
  namingConvention: "{role}_{energy}_{bpm}_{version}",
  operatorNotes: ["MVP metadata only; no encoded files are written."]
} satisfies ExportPresetDetail["playback"];

const presetDetails: Record<ExportManifest["preset"], ExportPresetDetail> = {
  resolume: {
    preset: "resolume",
    label: "Resolume Arena",
    folders: ["media", "reports", "thumbnails", "resolume"],
    requiredFiles: ["manifest.json", "safety-report.json", "visual-dna.json", "energy-map.json", "media/*.mov"],
    playback: {
      ...defaultPlayback,
      codecTarget: "prores",
      alphaSupport: "unknown",
      operatorNotes: [
        "ProRes 4444 is created only by the durable Resolume export job from a human-approved clip.",
        "The delivery manifest records alpha only after decoding verifies the source and output.",
        "DXV3 is not implied by this package."
      ]
    },
    handoffNotes: [
      "Import the delivered MOV directly into Resolume and retain manifest.json beside the media.",
      "Run the separate sustained playback acceptance before show use."
    ],
    notes: ["The first production slice exports one exact approved asset with its v3 seam evidence; multi-clip pack assembly remains a follow-up capability."]
  },
  madmapper: {
    preset: "madmapper",
    label: "MadMapper Media Folder",
    folders: ["media", "thumbnails", "mapping-notes"],
    requiredFiles: ["manifest.json", "safety-report.json", "stage-preview.json"],
    playback: defaultPlayback,
    handoffNotes: ["Use `stage-preview.json` to check surface readability before mapping."],
    notes: ["Folder names avoid spaces for projection workstation compatibility."]
  },
  touchdesigner: {
    preset: "touchdesigner",
    label: "TouchDesigner Media Folder",
    folders: ["movies", "thumbs", "metadata"],
    requiredFiles: ["manifest.json", "safety-report.json", "clip-table.json"],
    playback: { ...defaultPlayback, codecTarget: "h264" },
    handoffNotes: ["MVP exports media metadata only; build the TOP network manually."],
    notes: ["MVP exports media and metadata only, not a TouchDesigner project file."]
  },
  led_wall: {
    preset: "led_wall",
    label: "Generic LED Wall Playback",
    folders: ["approved-loops", "fallback-loops", "operator-notes"],
    requiredFiles: ["manifest.json", "safety-report.json", "format-validation.json"],
    playback: defaultPlayback,
    handoffNotes: ["Keep fallback loops in a separate folder for show safety.", "Check brightness and flicker warnings before playback."],
    notes: ["Includes brightness and readability notes for LED operators."]
  },
  social: {
    preset: "social",
    label: "Social Visualizer",
    folders: ["vertical", "square", "thumbnails"],
    requiredFiles: ["manifest.json", "safety-report.json", "caption-notes.json"],
    playback: { ...defaultPlayback, resolution: "1080x1920", loopDurationSeconds: 8 },
    handoffNotes: ["Use social crops as teasers, not as the main VJ playback pack."],
    notes: ["Uses the same Visual DNA for social teaser outputs."]
  },
  client_review: {
    preset: "client_review",
    label: "Client Review Package",
    folders: ["review-clips", "contact-sheet", "reports"],
    requiredFiles: ["manifest.json", "safety-report.json", "license-notes.md"],
    playback: { ...defaultPlayback, codecTarget: "h264" },
    handoffNotes: ["Include license notes and safety report for non-technical approval."],
    notes: ["Designed for non-technical client approval before show delivery."]
  }
};

export function buildExportPresetDetail(preset: ExportManifest["preset"]): ExportPresetDetail {
  return exportPresetDetailSchema.parse(presetDetails[preset]);
}
