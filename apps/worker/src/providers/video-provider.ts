import type { ClipPrompt, GeneratedClip } from "@droploop/schemas";

export type ProviderJobStatus = "queued" | "running" | "completed" | "failed";

export type GenerateVideoInput = {
  projectId: string;
  prompt: ClipPrompt;
};

export type RepairVideoInput = {
  projectId: string;
  clip: GeneratedClip;
  repairInstruction: string;
};

export interface VideoProvider {
  generateVideo(input: GenerateVideoInput): Promise<GeneratedClip>;
  repairVideo(input: RepairVideoInput): Promise<GeneratedClip>;
  getJobStatus(providerJobId: string): Promise<ProviderJobStatus>;
}
