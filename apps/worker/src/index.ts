import { createDatabaseClient, PostgresDurableJobRepository } from "@droploop/database";
import { DurableJobController } from "@droploop/pipeline";
import { clipPromptSchema } from "@droploop/schemas";
import { createVideoProvider, selectVideoProviderName } from "./providers/provider-factory";
import { OutputProcessingError, ProviderOutputProcessor } from "./output/provider-output-processor";
import { SupabaseOutputObjectStore } from "./output/supabase-output-store";
import { LoopAnalysisProcessor, LoopValidationError } from "./output/loop-analysis-processor";
import {
  LOCAL_LOOP_REPAIR_MODEL,
  LOCAL_LOOP_REPAIR_PROVIDER,
  LocalLoopRepairError,
  LocalLoopRepairProcessor
} from "./output/local-loop-repair-processor";
import { LOOP_REPAIR_POLICY_V1 } from "@droploop/media";
import { PRORES_4444_EXPORT_POLICY_V1 } from "@droploop/media";
import {
  LOCAL_RESOLUME_EXPORT_MODEL,
  LOCAL_RESOLUME_EXPORT_PROVIDER,
  ResolumeExportError,
  ResolumeExportProcessor
} from "./output/resolume-export-processor";

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const leaseSeconds = Number(process.env.JOB_LEASE_SECONDS ?? 60);
const sql = createDatabaseClient();
const repository = new PostgresDurableJobRepository(sql);
const defaultProviderName = process.env.VIDEO_PROVIDER ?? "mock";
const repairEngine = process.env.LOOP_REPAIR_ENGINE ?? "local";

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
        const selectedRepairEngine = job.status === "repairing" && job.provider === LOCAL_LOOP_REPAIR_PROVIDER
          ? "local"
          : repairEngine;
        if (!job.sourceAssetId || !job.sourceAnalysisId || typeof job.input.plannedClipId !== "string") {
          await repository.updateJob(job.id, [job.status], {
            status: "failed",
            errorCategory: "validation_failed",
            errorMessage: "Repair job is missing exact immutable source asset and analysis lineage."
          });
        } else if (selectedRepairEngine === "local") {
          const localJob = await controller.beginLocalRepair(job.id, {
            provider: LOCAL_LOOP_REPAIR_PROVIDER,
            model: LOCAL_LOOP_REPAIR_MODEL,
            providerJobId: `local-loop-doctor:${job.id}:${LOCAL_LOOP_REPAIR_MODEL}`,
            config: { ...LOOP_REPAIR_POLICY_V1 }
          });
          try {
            const output = await new LocalLoopRepairProcessor(
              repository,
              new SupabaseOutputObjectStore()
            ).process(localJob);
            await controller.completeLocalRepair(job.id, output.assetId, output.materializationLatencyMs);
          } catch (error) {
            const failure = error instanceof LocalLoopRepairError
              ? error
              : new LocalLoopRepairError(error instanceof Error ? error.message : "Unknown local repair failure.", true);
            await controller.recordLocalRepairFailure(job.id, failure.message, failure.retryable);
          }
        } else if (selectedRepairEngine === "provider") {
          await controller.submitRepair(job.id, {
            projectId: job.projectId,
            idempotencyKey: job.idempotencyKey,
            plannedClipId: job.input.plannedClipId,
            sourceAssetId: job.sourceAssetId,
            sourceAnalysisId: job.sourceAnalysisId,
            repairInstruction: String(job.input.repairInstruction ?? "Repair loop continuity.")
          });
        } else {
          await repository.updateJob(job.id, [job.status], {
            status: "failed",
            errorCategory: "validation_failed",
            errorMessage: `Unsupported LOOP_REPAIR_ENGINE: ${selectedRepairEngine}`
          });
        }
      } else if (job.operation === "export" && (job.status === "queued" || job.status === "exporting")) {
        const localExportJob = await controller.beginLocalResolumeExport(job.id, {
          provider: LOCAL_RESOLUME_EXPORT_PROVIDER,
          model: LOCAL_RESOLUME_EXPORT_MODEL,
          providerJobId: `local-resolume-export:${job.id}:${LOCAL_RESOLUME_EXPORT_MODEL}`,
          config: { ...PRORES_4444_EXPORT_POLICY_V1 }
        });
        try {
          await new ResolumeExportProcessor(repository, new SupabaseOutputObjectStore()).process(localExportJob);
        } catch (error) {
          const failure = error instanceof ResolumeExportError
            ? error
            : new ResolumeExportError(error instanceof Error ? error.message : "Unknown local Resolume export failure.", true);
          await controller.recordLocalResolumeExportFailure(job.id, failure.message, failure.retryable);
        }
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
