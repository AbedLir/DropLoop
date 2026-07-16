import { projectPipelineInputSchema, runProjectMockPipeline } from "@droploop/pipeline";
import { z } from "zod";
import { toErrorResponse } from "../../../lib/api-errors";
import { SupabaseProjectStore } from "../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../lib/supabase/auth";

const persistedProjectRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(200).optional()
});

export async function GET() {
  try {
    const { client } = await requireAuthenticatedSupabase();
    const projects = await new SupabaseProjectStore(client).listProjects();
    return Response.json({ projects });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const persistence = persistedProjectRequestSchema.parse(body);
    const projectId = persistence.projectId ?? crypto.randomUUID();
    const creationKey = persistence.idempotencyKey ?? projectId;
    const input = projectPipelineInputSchema.parse({
      projectId,
      ...body,
      bpm: Number(body.bpm),
      packSize: Number(body.packSize),
      references: parseReferences(body.references)
    });
    const { client, userId } = await requireAuthenticatedSupabase();
    const pipeline = await runProjectMockPipeline(input);
    const project = await new SupabaseProjectStore(client).createProject(userId, creationKey, input, pipeline);

    return Response.json({ project, pipeline }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
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
