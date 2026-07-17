import { createDatabaseClient, PostgresDurableJobRepository } from "@droploop/database";
import { DurableJobController } from "@droploop/pipeline";
import { clipPromptSchema, generatedClipSchema } from "@droploop/schemas";
import { createVideoProvider, selectVideoProviderName } from "./providers/provider-factory";
import { OutputProcessingError, ProviderOutputProcessor } from "./output/provider-output-processor";
import { SupabaseOutputObjectStore } from "./output/supabase-output-store";
import { LoopAnalysisProcessor, LoopValidationError } from "./output/loop-analysis-processor";

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const leaseSeconds = Number(process.env.JOB_LEASE_SECONDS ?? 60);
const sql = createDatabaseClient();
const repository = new PostgresDurableJobRepository(sql);
const defaultProviderName = process.env.VIDEO_PROVIDER ?? "mock";

try {
  const job = await repository.claimNextJob(workerId, leaseSeconds);

  if (!job) {
    console.log("No claimable DropLoop jobs.");
  } else {
    const provider = createVideoProvider(selectVideoProviderName(job.provider, defaultProviderName));
    const controller = new DurableJobController(repository, provider);
    try {
      if (job.operation === "generate" && job.status === "queued") {
        await controller.submitGeneration(job.id, {
          projectId: job.projectId,
          idempotencyKey: job.idempotencyKey,
          prompt: clipPromptSchema.parse(job.input.prompt)
        });
      } else if (job.operation === "repair" && (job.status === "queued" || job.status === "repairing")) {
        await controller.submitRepair(job.id, {
          projectId: job.projectId,
          idempotencyKey: job.idempotencyKey,
          clip: generatedClipSchema.parse(job.input.clip),
          repairInstruction: String(job.input.repairInstruction ?? "Repair loop continuity.")
        });
      } else if (job.status === "submitting") {
        await controller.recoverInterruptedSubmission(job.id);
      } else if (job.status === "provider_running") {
        await controller.refresh(job.id);
      } else if (job.status === "downloading") {
        try {
          if (job.outputAssetId) {
            await controller.completeDownload(job.id, job.outputAssetId, job.downloadLatencyMs);
          } else {
            const processor = new ProviderOutputProcessor(repository, new SupabaseOutputObjectStore());
            const output = await processor.process(job);
            await controller.completeDownload(job.id, output.assetId, output.downloadLatencyMs);
          }
        } catch (error) {
          const failure =
            error instanceof OutputProcessingError
              ? error
              : new OutputProcessingError(error instanceof Error ? error.message : "Unknown output failure.", true);
          await controller.recordDownloadFailure(job.id, failure.message, failure.retryable);
        }
      } else if (job.status === "validating") {
        try {
          const objectStore = new SupabaseOutputObjectStore();
          await new LoopAnalysisProcessor(repository, objectStore).process(job);
          await controller.completeValidation(job.id);
        } catch (error) {
          const failure = error instanceof LoopValidationError
            ? error
            : new LoopValidationError(error instanceof Error ? error.message : "Unknown loop validation failure.", true);
          await controller.recordValidationFailure(job.id, failure.message, failure.retryable);
        }
      } else {
        console.log(`Claimed job ${job.id} in ${job.status}; no worker action is registered.`);
      }
    } finally {
      await repository.releaseLease(job.id, workerId);
    }
  }
} finally {
  await sql.end();
}
