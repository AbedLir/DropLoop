import { createDatabaseClient, PostgresDurableJobRepository } from "@droploop/database";
import { DurableJobController } from "@droploop/pipeline";
import { clipPromptSchema, generatedClipSchema } from "@droploop/schemas";
import { MockVideoProvider } from "./providers/mock-video-provider";
import { SeedanceProvider } from "./providers/seedance-provider";
import type { VideoProvider } from "./providers/video-provider";

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const leaseSeconds = Number(process.env.JOB_LEASE_SECONDS ?? 60);
const sql = createDatabaseClient();
const repository = new PostgresDurableJobRepository(sql);
const provider = createProvider(process.env.VIDEO_PROVIDER ?? "mock");
const controller = new DurableJobController(repository, provider);

try {
  const job = await repository.claimNextJob(workerId, leaseSeconds);

  if (!job) {
    console.log("No claimable DropLoop jobs.");
  } else {
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
      } else {
        console.log(`Claimed job ${job.id} in ${job.status}; its next media step belongs to P0-C/P0-D.`);
      }
    } finally {
      await repository.releaseLease(job.id, workerId);
    }
  }
} finally {
  await sql.end();
}

function createProvider(name: string): VideoProvider {
  if (name === "mock") {
    return new MockVideoProvider();
  }
  if (name === "seedance") {
    return new SeedanceProvider();
  }
  throw new Error(`Unsupported VIDEO_PROVIDER: ${name}`);
}
