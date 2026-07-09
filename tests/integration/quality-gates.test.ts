import { evaluateClipGate } from "@droploop/pipeline";
import type { GeneratedClip, QualityScore, SafetyReport, StagePreview } from "@droploop/schemas";
import { describe, expect, it } from "vitest";

const clip: GeneratedClip = {
  id: "clip",
  clipId: "drop-1",
  role: "drop",
  status: "generated",
  previewUrl: "/drop.mp4",
  thumbnailUrl: "/drop.jpg",
  durationSeconds: 8,
  loopScore: 92,
  qualityScore: 90
};

const quality: QualityScore = {
  loopContinuity: 92,
  motionStability: 88,
  stageReadability: 84,
  styleConsistency: 90,
  energyMatch: 91,
  artifactRisk: 8,
  textLogoFaceRisk: 0,
  brightnessSafety: 78,
  decision: "use_directly"
};

const preview: StagePreview = {
  screenFormat: "16:9",
  surfaces: ["led_wall"],
  stageReadability: 84,
  brightnessSafety: 78,
  contrastScore: 86,
  safeMargins: "8%",
  safeViewingDistance: "FOH",
  notes: []
};

const safety: SafetyReport = {
  copyrightedCharacterRisk: 0,
  celebrityLikenessRisk: 0,
  unauthorizedBrandRisk: 0,
  readableTextRisk: 0,
  watermarkRisk: 0,
  flickerRisk: 12,
  ownershipRisk: 8,
  commercialUsageRisk: "low",
  notes: []
};

describe("evaluateClipGate", () => {
  it("approves clips that pass MVP thresholds", () => {
    expect(evaluateClipGate(clip, quality, preview, safety)).toEqual({
      approved: true,
      recommendedAction: "approve",
      reasons: []
    });
  });

  it("recommends regeneration for unsafe flicker", () => {
    const result = evaluateClipGate(clip, quality, preview, { ...safety, flickerRisk: 40 });

    expect(result.approved).toBe(false);
    expect(result.recommendedAction).toBe("regenerate");
  });
});
