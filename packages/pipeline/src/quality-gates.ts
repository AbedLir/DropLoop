import type { ClipReview, GeneratedClip, QualityScore, SafetyReport, StagePreview } from "@droploop/schemas";

export type ClipGateResult = {
  approved: boolean;
  recommendedAction: ClipReview["recommendedAction"];
  reasons: string[];
};

export function evaluateClipGate(
  clip: GeneratedClip,
  quality: QualityScore,
  preview: StagePreview,
  safety: SafetyReport
): ClipGateResult {
  const repairReasons: string[] = [];
  const regenerateReasons: string[] = [];

  if (clip.loopScore < 80) repairReasons.push("loopScore below 80");
  if (quality.stageReadability < 75 || preview.stageReadability < 75) repairReasons.push("stageReadability below 75");
  if (quality.textLogoFaceRisk > 10) regenerateReasons.push("textLogoFaceRisk above 10");
  if (safety.flickerRisk > 20) regenerateReasons.push("flickerRisk above 20");
  if (quality.brightnessSafety < 70 || preview.brightnessSafety < 70) repairReasons.push("brightnessSafety below 70");

  const reasons = [...repairReasons, ...regenerateReasons];

  if (reasons.length === 0) {
    return { approved: true, recommendedAction: "approve", reasons: [] };
  }

  return {
    approved: false,
    recommendedAction: regenerateReasons.length > 0 ? "regenerate" : "repair",
    reasons
  };
}
