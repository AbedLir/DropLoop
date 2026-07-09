import { generatedClipSchema } from "@droploop/schemas";
import type { GeneratedClip } from "@droploop/schemas";
import type { GenerateVideoInput, RepairVideoInput, VideoProvider } from "./video-provider";

export class MockVideoProvider implements VideoProvider {
  async generateVideo(input: GenerateVideoInput): Promise<GeneratedClip> {
    return generatedClipSchema.parse({
      id: `mock-${input.projectId}-${input.prompt.clipId}`,
      clipId: input.prompt.clipId,
      role: input.prompt.role,
      status: "generated",
      previewUrl: `/mock/clips/${input.prompt.clipId}.mp4`,
      thumbnailUrl: `/mock/thumbnails/${input.prompt.clipId}.jpg`,
      durationSeconds: input.prompt.durationSeconds,
      loopScore: Math.min(95, 72 + Math.round(input.prompt.energy / 5)),
      qualityScore: Math.min(96, 74 + Math.round(input.prompt.energy / 6))
    });
  }

  async repairVideo(input: RepairVideoInput): Promise<GeneratedClip> {
    return generatedClipSchema.parse({
      ...input.clip,
      id: `${input.clip.id}-repaired`,
      status: "generated",
      loopScore: Math.min(100, input.clip.loopScore + 8),
      qualityScore: Math.min(100, input.clip.qualityScore + 6)
    });
  }

  async getJobStatus(): Promise<"completed"> {
    return "completed";
  }
}
