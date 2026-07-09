import { createDemoWorkspace } from "@droploop/pipeline";
import { reviewActionSchema } from "@droploop/schemas";

export async function GET() {
  const workspace = await createDemoWorkspace();

  return Response.json({
    reviews: workspace.reviewQueue,
    clips: workspace.clips.map((clip) => ({
      id: clip.id,
      clipId: clip.clipId,
      role: clip.role,
      loopScore: clip.loopScore,
      qualityScore: clip.qualityScore
    }))
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const action = reviewActionSchema.parse(body.action);
  const clipId = String(body.clipId ?? "");

  const status = {
    approve: "approved",
    reject: "rejected",
    repair: "repair_requested",
    regenerate: "regenerate_requested"
  }[action];

  return Response.json({
    clipId,
    action,
    status,
    reason: `MVP mock review action applied: ${action}`
  });
}
