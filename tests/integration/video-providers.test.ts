import { createHmac } from "node:crypto";
import { ProviderError } from "@droploop/pipeline";
import { describe, expect, it } from "vitest";
import { KlingProvider, createKlingJwt } from "../../apps/worker/src/providers/kling-provider";
import { selectVideoProviderName } from "../../apps/worker/src/providers/provider-factory";
import type { ProviderFetch } from "../../apps/worker/src/providers/provider-http";
import { SeedanceProvider } from "../../apps/worker/src/providers/seedance-provider";

const fixedNow = new Date("2026-07-16T12:00:00.000Z");
const now = () => fixedNow;

const input = {
  projectId: "project-1",
  idempotencyKey: "project-1:drop-1:v1",
  prompt: {
    clipId: "drop-1",
    role: "drop" as const,
    durationSeconds: 8,
    energy: 90,
    positivePrompt: "chrome tunnel pulse",
    negativePrompt: "text, faces, logos",
    loopRequirements: "matching boundary frames",
    stageRequirements: "LED-readable contrast",
    qualityTargets: {}
  }
};

describe("Seedance 2.0 provider contract", () => {
  it("submits the official model through the Ark v3 task endpoint without a live request", async () => {
    const calls: FetchCall[] = [];
    const provider = new SeedanceProvider({
      apiKey: "seedance-test-key",
      fetch: fakeFetch(calls, [{ id: "seed-task-1", status: "queued" }]),
      now
    });

    const submission = await provider.submitGeneration(input);

    expect(submission).toMatchObject({
      providerJobId: "seed-task-1",
      status: "queued",
      submittedAt: fixedNow.toISOString()
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer seedance-test-key");

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "doubao-seedance-2-0-260128",
      ratio: "16:9",
      duration: 8,
      resolution: "720p",
      generate_audio: true,
      watermark: false
    });
  });

  it("normalizes successful polling and uses the documented DELETE cancellation endpoint", async () => {
    const calls: FetchCall[] = [];
    const provider = new SeedanceProvider({
      apiKey: "seedance-test-key",
      fetch: fakeFetch(calls, [
        {
          id: "seed-task-1",
          status: "succeeded",
          content: { video_url: "https://provider.example/seedance.mp4" }
        },
        {}
      ]),
      now
    });

    await expect(provider.getJob("seed-task-1")).resolves.toMatchObject({
      providerJobId: "seed-task-1",
      status: "completed",
      progress: 100,
      result: { previewUrl: "https://provider.example/seedance.mp4" }
    });
    await provider.cancelJob("seed-task-1");

    expect(calls[1]?.init.method).toBe("DELETE");
    expect(calls[1]?.url).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/seed-task-1"
    );
  });
});

describe("Kling provider contract", () => {
  it("creates the official HS256 bearer JWT without exposing the secret", () => {
    const token = createKlingJwt("access-key", "secret-key", fixedNow);
    const [header, payload, signature] = token.split(".");
    const decodedHeader = decodeJwtPart(header);
    const decodedPayload = decodeJwtPart(payload);
    const expectedSignature = createHmac("sha256", "secret-key")
      .update(`${header}.${payload}`)
      .digest("base64url");

    expect(decodedHeader).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decodedPayload).toEqual({
      iss: "access-key",
      exp: Math.floor(fixedNow.getTime() / 1000) + 1_800,
      nbf: Math.floor(fixedNow.getTime() / 1000) - 5
    });
    expect(signature).toBe(expectedSignature);
    expect(token).not.toContain("secret-key");
  });

  it("submits and polls the stable v2.1 Master text-to-video contract with fake transport", async () => {
    const calls: FetchCall[] = [];
    const provider = new KlingProvider({
      accessKey: "access-key",
      secretKey: "secret-key",
      fetch: fakeFetch(calls, [
        { code: 0, message: "SUCCEED", data: { task_id: "kling-task-1", task_status: "submitted" } },
        {
          code: 0,
          message: "SUCCEED",
          data: {
            task_id: "kling-task-1",
            task_status: "succeed",
            task_result: { videos: [{ url: "https://provider.example/kling.mp4" }] }
          }
        }
      ]),
      now
    });

    await expect(provider.submitGeneration(input)).resolves.toMatchObject({
      providerJobId: "kling-task-1",
      status: "queued"
    });
    await expect(provider.getJob("kling-task-1")).resolves.toMatchObject({
      providerJobId: "kling-task-1",
      status: "completed",
      progress: 100,
      result: { previewUrl: "https://provider.example/kling.mp4" }
    });

    expect(calls[0]?.url).toBe("https://api-singapore.klingai.com/v1/videos/text2video");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model_name: "kling-v2-1-master",
      mode: "pro",
      duration: "10",
      aspect_ratio: "16:9"
    });
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
  });

  it("classifies rate limits before the durable controller applies its retry policy", async () => {
    const provider = new KlingProvider({
      accessKey: "access-key",
      secretKey: "secret-key",
      fetch: fakeFetch([], [{ message: "Too many requests", httpStatus: 429 }]),
      now
    });

    const error = await provider.submitGeneration(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ category: "provider_rate_limited" });
  });

  it("fails closed when cancellation is not part of the verified Kling API contract", async () => {
    const provider = new KlingProvider({ accessKey: "access-key", secretKey: "secret-key", now });
    await expect(provider.cancelJob("kling-task-1")).rejects.toMatchObject({
      category: "provider_rejected"
    });
  });
});

describe("worker provider affinity", () => {
  it("uses the configured default only before submission and preserves the persisted provider afterward", () => {
    expect(selectVideoProviderName(undefined, "seedance")).toBe("seedance");
    expect(selectVideoProviderName("seedance", "kling")).toBe("seedance");
    expect(selectVideoProviderName("kling", "seedance")).toBe("kling");
  });
});

type FetchCall = {
  url: string;
  init: RequestInit;
};

type FakeResponse = Record<string, unknown> & { httpStatus?: number };

function fakeFetch(calls: FetchCall[], responses: FakeResponse[]): ProviderFetch {
  let index = 0;
  return async (request, init = {}) => {
    calls.push({ url: String(request), init });
    const fixture = responses[index];
    index += 1;
    if (!fixture) {
      throw new Error(`Missing fake response ${index}.`);
    }
    const { httpStatus = 200, ...body } = fixture;
    return new Response(JSON.stringify(body), {
      status: httpStatus,
      headers: { "Content-Type": "application/json" }
    });
  };
}

function decodeJwtPart(value: string | undefined): unknown {
  if (!value) {
    throw new Error("JWT part is missing.");
  }
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}
