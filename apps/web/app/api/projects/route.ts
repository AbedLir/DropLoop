import { projectPipelineInputSchema, runProjectMockPipeline } from "@droploop/pipeline";
import { projectSchema } from "@droploop/schemas";

export async function GET() {
  const project = projectSchema.parse({
    id: "demo",
    userId: "local-user",
    name: "Dark Melodic Techno",
    status: "reviewing",
    template: "festival_mainstage",
    musicGenre: "dark melodic techno",
    bpm: 126,
    screenFormat: "16:9",
    packSize: 12,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  });

  const workspace = await runProjectMockPipeline({
    projectId: project.id,
    projectName: project.name,
    template: project.template,
    musicGenre: project.musicGenre ?? "dark melodic techno",
    bpm: project.bpm ?? 126,
    showType: "festival LED wall",
    screenFormat: project.screenFormat,
    packSize: project.packSize,
    desiredMood: "dark melodic techno, laser haze, high contrast stage depth",
    references: ["festival LED wall", "touring DJ support"]
  });

  return Response.json({ projects: [project], workspace });
}

export async function POST(request: Request) {
  const body = await request.json();
  const input = projectPipelineInputSchema.parse({
    projectId: crypto.randomUUID(),
    ...body,
    bpm: Number(body.bpm),
    packSize: Number(body.packSize),
    references: parseReferences(body.references)
  });

  const pipeline = await runProjectMockPipeline(input);

  return Response.json(
    {
      project: {
        id: input.projectId,
        name: input.projectName,
        status: "reviewing"
      },
      pipeline
    },
    { status: 201 }
  );
}

function parseReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
}
