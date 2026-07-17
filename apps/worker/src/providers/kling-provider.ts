import { createHmac } from "node:crypto";
import { ProviderError } from "@droploop/pipeline";
import { providerJobSnapshotSchema, providerSubmissionSchema } from "@droploop/schemas";
import type { ProviderJobSnapshot, ProviderJobStatus, ProviderSubmission } from "@droploop/schemas";
import type { GenerateVideoInput, RepairVideoInput, VideoProvider } from "./video-provider";
import {
  asProviderRecord,
  optionalProviderString,
  requestProviderJson,
  requireProviderString,
  sanitizeProviderResponse,
  trimTrailingSlash
} from "./provider-http";
import type { ProviderFetch } from "./provider-http";

const DEFAULT_BASE_URL = "https://api-singapore.klingai.com";
const DEFAULT_MODEL = "kling-v2-1-master";

export type KlingProviderOptions = {
  accessKey?: string;
  secretKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: ProviderFetch;
  now?: () => Date;
  timeoutMs?: number;
};

export class KlingProvider implements VideoProvider {
  readonly name = "kling";
  readonly model: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetch: ProviderFetch | undefined;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: KlingProviderOptions = {}) {
    this.accessKey = requireConfiguration(options.accessKey ?? process.env.KLING_ACCESS_KEY, "KLING_ACCESS_KEY");
    this.secretKey = requireConfiguration(options.secretKey ?? process.env.KLING_SECRET_KEY, "KLING_SECRET_KEY");
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.KLING_API_BASE_URL ?? DEFAULT_BASE_URL);
    this.model = requireConfiguration(options.model ?? process.env.KLING_MODEL ?? DEFAULT_MODEL, "KLING_MODEL");
    this.fetch = options.fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async submitGeneration(input: GenerateVideoInput): Promise<ProviderSubmission> {
    const rawResponse = await this.request("/v1/videos/text2video", {
      method: "POST",
      body: JSON.stringify({
        model_name: this.model,
        prompt: buildKlingPrompt(input),
        negative_prompt: input.prompt.negativePrompt,
        mode: "pro",
        duration: klingDuration(input.prompt.durationSeconds),
        aspect_ratio: "16:9"
      })
    });
    const response = asProviderRecord(rawResponse);
    assertKlingResponseAccepted(response);
    const data = asProviderRecord(response.data);
    const providerJobId = requireProviderString(data.task_id, "task id");

    return providerSubmissionSchema.parse({
      providerJobId,
      status: mapKlingStatus(data.task_status),
      submittedAt: this.now().toISOString(),
      rawResponse: sanitizeProviderResponse(rawResponse)
    });
  }

  async submitRepair(_input: RepairVideoInput): Promise<ProviderSubmission> {
    throw new ProviderError(
      "internal",
      "Kling repair submission remains disabled until its verified endpoint can consume a short-lived URL for the bound source asset."
    );
  }

  async getJob(providerJobId: string): Promise<ProviderJobSnapshot> {
    const rawResponse = await this.request(`/v1/videos/text2video/${encodeURIComponent(providerJobId)}`, {
      method: "GET"
    });
    const response = asProviderRecord(rawResponse);
    assertKlingResponseAccepted(response);
    const data = asProviderRecord(response.data);
    const taskResult = asProviderRecord(data.task_result);
    const videos = Array.isArray(taskResult.videos) ? taskResult.videos : [];
    const firstVideo = asProviderRecord(videos[0]);
    const previewUrl = optionalProviderString(firstVideo.url);
    const status = mapKlingStatus(data.task_status);
    const errorMessage = optionalProviderString(data.task_status_msg);

    return providerJobSnapshotSchema.parse({
      providerJobId: optionalProviderString(data.task_id) ?? providerJobId,
      status,
      progress: statusProgress(status),
      ...(previewUrl ? { result: { previewUrl } } : {}),
      ...(status === "failed" ? { errorCategory: "provider_rejected" as const } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      rawResponse: sanitizeProviderResponse(rawResponse),
      updatedAt: this.now().toISOString()
    });
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    throw new ProviderError(
      "provider_rejected",
      "Kling text-to-video API does not expose a verified task-cancellation endpoint."
    );
  }

  private request(path: string, init: RequestInit): Promise<unknown> {
    return requestProviderJson(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${createKlingJwt(this.accessKey, this.secretKey, this.now())}`,
          "Content-Type": "application/json"
        }
      },
      {
        ...(this.fetch ? { fetch: this.fetch } : {}),
        timeoutMs: this.timeoutMs
      }
    );
  }
}

export function createKlingJwt(accessKey: string, secretKey: string, now: Date): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: accessKey,
      exp: nowSeconds + 1_800,
      nbf: nowSeconds - 5
    })
  );
  const signature = createHmac("sha256", secretKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function buildKlingPrompt(input: GenerateVideoInput): string {
  return [input.prompt.positivePrompt, input.prompt.loopRequirements, input.prompt.stageRequirements].join(". ");
}

function klingDuration(durationSeconds: number): "5" | "10" {
  return durationSeconds <= 5 ? "5" : "10";
}

function assertKlingResponseAccepted(response: Record<string, unknown>): void {
  const code = response.code;
  if (code === undefined || code === 0 || code === "0") {
    return;
  }
  const message = optionalProviderString(response.message) ?? "Kling rejected the request.";
  throw new ProviderError("provider_rejected", `Kling API error ${String(code)}: ${message}`);
}

function mapKlingStatus(value: unknown): ProviderJobStatus {
  switch (typeof value === "string" ? value.toLowerCase() : "submitted") {
    case "submitted":
    case "queued":
    case "pending":
      return "queued";
    case "processing":
    case "running":
      return "running";
    case "succeed":
    case "succeeded":
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      throw new ProviderError("provider_rejected", `Unknown Kling task status: ${String(value)}.`);
  }
}

function statusProgress(status: ProviderJobStatus): number {
  if (status === "completed") return 100;
  if (status === "running") return 50;
  return 0;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function requireConfiguration(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required when VIDEO_PROVIDER=kling.`);
  }
  return value;
}
