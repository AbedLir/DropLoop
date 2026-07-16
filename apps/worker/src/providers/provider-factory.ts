import { KlingProvider } from "./kling-provider";
import { MockVideoProvider } from "./mock-video-provider";
import { SeedanceProvider } from "./seedance-provider";
import type { VideoProvider } from "./video-provider";

export function selectVideoProviderName(jobProvider: string | undefined, defaultProvider: string): string {
  return jobProvider ?? defaultProvider;
}

export function createVideoProvider(name: string): VideoProvider {
  if (name === "mock") {
    return new MockVideoProvider();
  }
  if (name === "seedance") {
    return new SeedanceProvider();
  }
  if (name === "kling") {
    return new KlingProvider();
  }
  throw new Error(`Unsupported VIDEO_PROVIDER: ${name}`);
}
