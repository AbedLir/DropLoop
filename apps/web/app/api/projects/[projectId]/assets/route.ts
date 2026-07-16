import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { ApiError, toErrorResponse } from "../../../../../lib/api-errors";
import { analyzeAudioBpm } from "../../../../../lib/media/bpm";
import { MediaProbeError, probeMediaFile, type MediaKind } from "../../../../../lib/media/ffprobe";
import { SupabaseProjectStore } from "../../../../../lib/projects/project-store";
import { requireAuthenticatedSupabase } from "../../../../../lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const roleSchema = z.enum(["source_audio", "mood_reference"]);
const acceptedMimeTypes: Readonly<Record<string, MediaKind>> = {
  "audio/flac": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video"
};

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const { client } = await requireAuthenticatedSupabase();
    const assets = await new SupabaseProjectStore(client).listAssets(projectId);
    if (!assets) {
      throw new ApiError(404, "Project not found.", "project_not_found");
    }
    return Response.json({ assets });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  let storagePath: string | null = null;
  let storageClient: Awaited<ReturnType<typeof requireAuthenticatedSupabase>>["client"] | null = null;

  try {
    const { projectId } = await params;
    z.string().uuid().parse(projectId);
    const formData = await request.formData();
    const role = roleSchema.parse(formData.get("role"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError(400, "A non-empty media file is required.", "asset_file_required");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, "Media files are limited to 64 MiB for this ingestion route.", "asset_too_large");
    }

    const kind = acceptedMimeTypes[file.type];
    if (!kind) {
      throw new ApiError(415, `Unsupported media type: ${file.type || "unknown"}.`, "unsupported_media_type");
    }
    if ((role === "source_audio" && kind !== "audio") || (role === "mood_reference" && kind === "audio")) {
      throw new ApiError(400, "The selected asset role does not match the uploaded media type.", "asset_role_mismatch");
    }

    const { client, userId } = await requireAuthenticatedSupabase();
    storageClient = client;
    const assetId = crypto.randomUUID();
    const safeFilename = sanitizeFilename(file.name, kind);
    storagePath = `${userId}/${projectId}/sources/${assetId}/${safeFilename}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const analysis = await probeUpload(bytes, safeFilename, kind);

    const { error: uploadError } = await client.storage.from("project-assets").upload(storagePath, bytes, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false
    });
    if (uploadError) {
      throw new ApiError(502, "Unable to store the uploaded media.", "storage_upload_failed");
    }

    const asset = await new SupabaseProjectStore(client).registerAsset({
      assetId,
      projectId,
      kind,
      role,
      storagePath,
      filename: safeFilename,
      mimeType: file.type,
      sizeBytes: file.size,
      contentSha256,
      probe: analysis.probe,
      bpmAnalysis: analysis.bpmAnalysis
    });
    storagePath = null;
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    if (storagePath && storageClient) {
      await storageClient.storage.from("project-assets").remove([storagePath]);
    }
    if (error instanceof MediaProbeError) {
      return toErrorResponse(new ApiError(422, error.message, "media_probe_failed"));
    }
    return toErrorResponse(error);
  }
}

async function probeUpload(bytes: Buffer, filename: string, kind: MediaKind) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "droploop-probe-"));
  const temporaryFile = join(temporaryDirectory, filename);
  try {
    await writeFile(temporaryFile, bytes, { flag: "wx" });
    const [probe, bpmAnalysis] = await Promise.all([
      probeMediaFile(temporaryFile, kind),
      kind === "audio" ? analyzeAudioBpm(temporaryFile) : Promise.resolve(null)
    ]);
    return { probe, bpmAnalysis };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function sanitizeFilename(filename: string, kind: MediaKind): string {
  const fallback = `${kind}-asset`;
  const cleaned = basename(filename)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}
