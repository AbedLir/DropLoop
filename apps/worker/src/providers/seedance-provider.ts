import type { ProviderJobSnapshot, ProviderSubmission } from "@droploop/schemas";
import type { GenerateVideoInput, RepairVideoInput, VideoProvider } from "./video-provider";

export class SeedanceProvider implements VideoProvider {
  readonly name = "seedance";
  readonly model = process.env.SEEDANCE_MODEL ?? "unconfigured";

  async submitGeneration(_input: GenerateVideoInput): Promise<ProviderSubmission> {
    throw new Error("SeedanceProvider submission is not implemented. P0-C owns the production integration.");
  }

  async submitRepair(_input: RepairVideoInput): Promise<ProviderSubmission> {
    throw new Error("SeedanceProvider repair is not implemented. P0-D owns real loop repair.");
  }

  async getJob(_providerJobId: string): Promise<ProviderJobSnapshot> {
    throw new Error("SeedanceProvider polling is not implemented. P0-C owns the production integration.");
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    throw new Error("SeedanceProvider cancellation is not implemented. P0-C owns the production integration.");
  }
}
