import { classifyVjAssets } from "@droploop/pipeline";
import type { GeneratedClip, ReferenceAsset } from "@droploop/schemas";
import { describe, expect, it } from "vitest";

describe("classifyVjAssets", () => {
  it("classifies VJ loops with visual roles and playback metadata", () => {
    const references: ReferenceAsset[] = [
      {
        id: "audio",
        type: "audio",
        filename: "set.wav",
        mimeType: "audio/wav",
        sizeBytes: 100,
        description: "132 BPM",
        rightsStatus: "user_owned",
        detectedRisk: "low"
      }
    ];
    const clips: GeneratedClip[] = [
      {
        id: "clip-1",
        clipId: "drop-1",
        role: "drop",
        status: "generated",
        previewUrl: "/drop.mp4",
        thumbnailUrl: "/drop.jpg",
        durationSeconds: 8,
        loopScore: 92,
        qualityScore: 90
      }
    ];

    const assets = classifyVjAssets("project", references, clips);
    const loop = assets.find((asset) => asset.role === "vj_loop");

    expect(loop?.visualRole).toBe("drop_hit");
    expect(loop?.rightsStatus).toBe("generated");
    expect(loop?.playback?.codecTarget).toBe("mock");
    expect(assets.some((asset) => asset.role === "export_manifest")).toBe(true);
  });
});
