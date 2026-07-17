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

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MODEL = "doubao-seedance-2-0-260128";

export type SeedanceProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: ProviderFetch;
  now?: () => Date;
  timeoutMs?: number;
};

export class SeedanceProvider implements VideoProvider {
  readonly name = "seedance";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: ProviderFetch | undefined;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: SeedanceProviderOptions = {}) {
    this.apiKey = requireConfiguration(options.apiKey ?? process.env.SEEDANCE_API_KEY, "SEEDANCE_API_KEY");
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.SEEDANCE_API_BASE_URL ?? DEFAULT_BASE_URL);
    this.model = requireConfiguration(options.model ?? process.env.SEEDANCE_MODEL ?? DEFAULT_MODEL, "SEEDANCE_MODEL");
    this.fetch = options.fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async submitGeneration(input: GenerateVideoInput): Promise<ProviderSubmission> {
    const rawResponse = await this.request("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        content: [
          {
            type: "text",
            text: buildSeedancePrompt(input)
          }
        ],
        ratio: "16:9",
        duration: Math.round(input.prompt.durationSeconds),
        resolution: "720p",
        generate_audio: true,
        watermark: false
      })
    });
    const response = asProviderRecord(rawResponse);
    const providerJobId = requireProviderString(response.id, "task id");

    return providerSubmissionSchema.parse({
      providerJobId,
      status: mapSeedanceStatus(response.status),
      submittedAt: this.now().toISOString(),
      rawResponse: sanitizeProviderResponse(rawResponse)
    });
  }

  async submitRepair(_input: RepairVideoInput): Promise<ProviderSubmission> {
    throw new ProviderError(
      "internal",
      "Seedance repair submission remains disabled until its verified endpoint can consume a short-lived URL for the bound source asset."
    );
  }

  async getJob(providerJobId: string): Promise<ProviderJobSnapshot> {
    const rawResponse = await this.request(`/contents/generations/tasks/${encodeURIComponent(providerJobId)}`, {
      method: "GET"
    });
    const response = asProviderRecord(rawResponse);
    const content = asProviderRecord(response.content);
    const status = mapSeedanceStatus(response.status);
    const previewUrl = optionalProviderString(content.video_url);
    const error = asProviderRecord(response.error);
    const errorMessage =
      optionalProviderString(response.message) ??
      optionalProviderString(response.error_message) ??
      optionalProviderString(error.message);

    return providerJobSnapshotSchema.parse({
      providerJobId: optionalProviderString(response.id) ?? providerJobId,
      status,
      progress: statusProgress(status),
      ...(previewUrl ? { result: { previewUrl } } : {}),
      ...(status === "failed" ? { errorCategory: "provider_rejected" as const } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      rawResponse: sanitizeProviderResponse(rawResponse),
      updatedAt: this.now().toISOString()
    });
  }

  async cancelJob(providerJobId: string): Promise<void> {
    await this.request(`/contents/generations/tasks/${encodeURIComponent(providerJobId)}`, {
      method: "DELETE"
    });
  }

  private request(path: string, init: RequestInit): Promise<unknown> {
    return requestProviderJson(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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

function buildSeedancePrompt(input: GenerateVideoInput): string {
  return [
    input.prompt.positivePrompt,
    `Loop requirement: ${input.prompt.loopRequirements}`,
    `Stage requirement: ${input.prompt.stageRequirements}`,
    `Avoid: ${input.prompt.negativePrompt}`
  ].join("\n");
}

function mapSeedanceStatus(value: unknown): ProviderJobStatus {
  switch (typeof value === "string" ? value.toLowerCase() : "queued") {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "processing":
      return "running";
    case "succeeded":
    case "completed":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
    case "error":
      return "failed";
    default:
      throw new ProviderError("provider_rejected", `Unknown Seedance task status: ${String(value)}.`);
  }
}

function statusProgress(status: ProviderJobStatus): number {
  if (status === "completed") return 100;
  if (status === "running") return 50;
  return 0;
}

function requireConfiguration(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required when VIDEO_PROVIDER=seedance.`);
  }
  return value;
}
