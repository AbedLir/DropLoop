import { ProviderError } from "@droploop/pipeline";

export type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ProviderHttpOptions = {
  fetch?: ProviderFetch;
  timeoutMs?: number;
};

export async function requestProviderJson(
  url: string,
  init: RequestInit,
  options: ProviderHttpOptions = {}
): Promise<unknown> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
    const payload = await readResponseBody(response);

    if (!response.ok) {
      throw new ProviderError(
        classifyProviderHttpStatus(response.status),
        providerHttpErrorMessage(response.status, payload)
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ProviderError("provider_timeout", `Provider request timed out after ${timeoutMs} ms.`);
    }
    const message = error instanceof Error ? error.message : "Unknown provider request failure.";
    throw new ProviderError("internal", `Provider request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function requireProviderString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProviderError("provider_rejected", `Provider response did not include ${label}.`);
  }
  return value;
}

export function optionalProviderString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function asProviderRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sanitizeProviderResponse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderResponse);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /(authorization|api[-_]?key|access[-_]?key|secret|token)/i.test(key)
        ? "[REDACTED]"
        : sanitizeProviderResponse(nested)
    ])
  );
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function classifyProviderHttpStatus(status: number): "provider_rejected" | "provider_timeout" | "provider_rate_limited" | "internal" {
  if (status === 408 || status === 504) {
    return "provider_timeout";
  }
  if (status === 429) {
    return "provider_rate_limited";
  }
  if (status >= 500) {
    return "internal";
  }
  return "provider_rejected";
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function providerHttpErrorMessage(status: number, payload: unknown): string {
  const body = asProviderRecord(payload);
  const error = asProviderRecord(body.error);
  const message =
    optionalProviderString(body.message) ??
    optionalProviderString(body.error_message) ??
    optionalProviderString(error.message) ??
    `HTTP ${status}`;
  return `Provider request failed (${status}): ${message}`;
}
