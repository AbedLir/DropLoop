import { createDemoWorkspace } from "@droploop/pipeline";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const workspace = await createDemoWorkspace();
  const { projectId } = await params;

  return Response.json({
    project: {
      id: projectId,
      name: workspace.brief.projectName,
      status: "reviewing"
    },
    pipeline: workspace
  });
}
