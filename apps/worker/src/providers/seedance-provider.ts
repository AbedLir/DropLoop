import type { GeneratedClip } from "@droploop/schemas";
import type { GenerateVideoInput, ProviderJobStatus, RepairVideoInput, VideoProvider } from "./video-provider";

export class SeedanceProvider implements VideoProvider {
  async generateVideo(_input: GenerateVideoInput): Promise<GeneratedClip> {
    throw new Error("SeedanceProvider is a stub. Use VIDEO_PROVIDER=mock for the MVP.");
  }

  async repairVideo(_input: RepairVideoInput): Promise<GeneratedClip> {
    throw new Error("SeedanceProvider repair is not implemented in the MVP.");
  }

  async getJobStatus(_providerJobId: string): Promise<ProviderJobStatus> {
    throw new Error("SeedanceProvider job status is not implemented in the MVP.");
  }
}
