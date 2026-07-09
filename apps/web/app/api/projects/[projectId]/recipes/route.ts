import { buildVjRecipeCatalog, createDemoWorkspace } from "@droploop/pipeline";

export async function GET() {
  const workspace = await createDemoWorkspace();

  return Response.json({
    recipes: buildVjRecipeCatalog(),
    agentEvents: workspace.agentEvents,
    stageResults: workspace.stageResults
  });
}
