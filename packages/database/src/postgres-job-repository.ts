import { randomUUID } from "node:crypto";
import { assertReserveJobTopology, JobConflictError } from "@droploop/pipeline";
import type {
  CreateAttemptInput,
  DurableJobRepository,
  JobChanges,
  ReserveJobInput
} from "@droploop/pipeline";
import { generationJobSchema, jobAttemptSchema, jobTimelineEventSchema } from "@droploop/schemas";
import type { DurableJobStatus, GenerationJob, JobAttempt, JobTimelineEvent } from "@droploop/schemas";
import type { DatabaseClient } from "./postgres-client";

type JobRow = {
  id: string;
  project_id: string;
  workflow_id: string;
  orchestration_mode: string;
  operation: string;
  idempotency_key: string;
  status: string;
  progress: number;
  input: Record<string, unknown> | string;
  provider: string | null;
  provider_job_id: string | null;
  provider_model: string | null;
  provider_config: Record<string, unknown> | string | null;
  attempt_count: number;
  max_attempts: number;
  cost_usd: string | number;
  error_category: string | null;
  error_message: string | null;
  leased_by: string | null;
  lease_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
};

type AttemptRow = {
  id: string;
  job_id: string;
  attempt_number: number;
  provider: string;
  provider_model: string | null;
  provider_job_id: string | null;
  status: string;
  cost_usd: string | number;
  raw_response: unknown;
  error_category: string | null;
  error_message: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
};

type TimelineRow = {
  id: string;
  sequence: string | number;
  job_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string | null;
  payload: Record<string, unknown> | string;
  created_at: Date | string;
};

const stageByOperation = {
  generate: "generate_video",
  repair: "loop_doctor",
  export: "export_pack"
} as const;

export class PostgresDurableJobRepository implements DurableJobRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async reserveJob(input: ReserveJobInput): Promise<{ job: GenerationJob; created: boolean }> {
    assertReserveJobTopology(input);
    const workflowId = input.workflowId ?? randomUUID();
    const orchestrationMode = input.orchestrationMode ?? "solo";
    const dependencies = input.dependsOnJobIds ?? [];

    return this.sql.begin(async (transaction) => {
      const rows = (await transaction.unsafe(
        `
          insert into generation_jobs (
            id,
            project_id,
            workflow_id,
            orchestration_mode,
            stage,
            operation,
            status,
            progress,
            input,
            idempotency_key,
            max_attempts
          )
          values ($1, $2, $3, $4, $5, $6, 'queued', 0, $7::jsonb, $8, $9)
          on conflict (project_id, idempotency_key) do nothing
          returning *
        `,
        [
          randomUUID(),
          input.projectId,
          workflowId,
          orchestrationMode,
          stageByOperation[input.operation],
          input.operation,
          transaction.json(input.input as never),
          input.idempotencyKey,
          input.maxAttempts ?? 3
        ]
      )) as unknown as JobRow[];

      const created = rows[0];
      if (created) {
        for (const dependencyId of dependencies) {
          await transaction.unsafe(
            "insert into job_dependencies (job_id, depends_on_job_id) values ($1, $2)",
            [created.id, dependencyId]
          );
        }
        return { job: mapJob(created), created: true };
      }

      const existing = (await transaction.unsafe(
        "select * from generation_jobs where project_id = $1 and idempotency_key = $2 limit 1",
        [input.projectId, input.idempotencyKey]
      )) as unknown as JobRow[];

      const row = existing[0];
      if (!row) {
        throw new JobConflictError(`Unable to reserve or find idempotent job ${input.idempotencyKey}.`);
      }

      const existingDependencies = (await transaction.unsafe(
        "select depends_on_job_id from job_dependencies where job_id = $1 order by depends_on_job_id",
        [row.id]
      )) as unknown as Array<{ depends_on_job_id: string }>;
      const existingDependencyIds = existingDependencies.map((dependency) => dependency.depends_on_job_id).sort();
      const requestedDependencyIds = [...dependencies].sort();

      if (
        row.operation !== input.operation ||
        row.orchestration_mode !== orchestrationMode ||
        (input.workflowId !== undefined && row.workflow_id !== input.workflowId) ||
        existingDependencyIds.length !== requestedDependencyIds.length ||
        existingDependencyIds.some((dependencyId, index) => dependencyId !== requestedDependencyIds[index])
      ) {
        throw new JobConflictError(
          `Idempotency key ${input.idempotencyKey} is already reserved with a different workflow topology.`
        );
      }

      return { job: mapJob(row), created: false };
    });
  }

  async getJob(jobId: string): Promise<GenerationJob | null> {
    const rows = (await this.sql.unsafe("select * from generation_jobs where id = $1 limit 1", [jobId])) as unknown as JobRow[];
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async claimNextJob(workerId: string, leaseSeconds: number): Promise<GenerationJob | null> {
    const rows = (await this.sql.unsafe("select * from claim_generation_job($1, $2)", [workerId, leaseSeconds])) as unknown as JobRow[];
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async releaseLease(jobId: string, workerId: string): Promise<boolean> {
    const rows = (await this.sql.unsafe("select release_generation_job_lease($1, $2) as released", [
      jobId,
      workerId
    ])) as unknown as Array<{ released: boolean }>;
    return rows[0]?.released ?? false;
  }

  async updateJob(jobId: string, expectedStatuses: DurableJobStatus[], changes: JobChanges): Promise<GenerationJob> {
    if (expectedStatuses.length === 0) {
      throw new JobConflictError("At least one expected job status is required for an optimistic update.");
    }

    const statusParameters = expectedStatuses.map((_, index) => `$${index + 3}`).join(", ");
    const rows = (await this.sql.unsafe(
      `
        update generation_jobs
        set
          status = case when $2::jsonb ? 'status' then $2::jsonb ->> 'status' else status end,
          progress = case when $2::jsonb ? 'progress' then ($2::jsonb ->> 'progress')::integer else progress end,
          provider = case when $2::jsonb ? 'provider' then $2::jsonb ->> 'provider' else provider end,
          provider_job_id = case when $2::jsonb ? 'providerJobId' then $2::jsonb ->> 'providerJobId' else provider_job_id end,
          provider_model = case when $2::jsonb ? 'providerModel' then $2::jsonb ->> 'providerModel' else provider_model end,
          provider_config = case when $2::jsonb ? 'providerConfig' then nullif($2::jsonb -> 'providerConfig', 'null'::jsonb) else provider_config end,
          attempt_count = case when $2::jsonb ? 'attemptCount' then ($2::jsonb ->> 'attemptCount')::integer else attempt_count end,
          cost_usd = case when $2::jsonb ? 'costUsd' then ($2::jsonb ->> 'costUsd')::numeric else cost_usd end,
          error_category = case when $2::jsonb ? 'errorCategory' then $2::jsonb ->> 'errorCategory' else error_category end,
          error_message = case when $2::jsonb ? 'errorMessage' then $2::jsonb ->> 'errorMessage' else error_message end,
          leased_by = case when $2::jsonb ? 'leasedBy' then $2::jsonb ->> 'leasedBy' else leased_by end,
          lease_expires_at = case when $2::jsonb ? 'leaseExpiresAt' then ($2::jsonb ->> 'leaseExpiresAt')::timestamptz else lease_expires_at end,
          started_at = case when $2::jsonb ? 'startedAt' then ($2::jsonb ->> 'startedAt')::timestamptz else started_at end,
          completed_at = case when $2::jsonb ? 'completedAt' then ($2::jsonb ->> 'completedAt')::timestamptz else completed_at end,
          cancelled_at = case when $2::jsonb ? 'cancelledAt' then ($2::jsonb ->> 'cancelledAt')::timestamptz else cancelled_at end,
          updated_at = now()
        where id = $1 and status in (${statusParameters})
        returning *
      `,
      [jobId, this.sql.json(changes as never), ...expectedStatuses]
    )) as unknown as JobRow[];

    const row = rows[0];
    if (!row) {
      throw new JobConflictError(
        `Job ${jobId} changed concurrently or is not in an expected status (${expectedStatuses.join(", ")}).`
      );
    }

    return mapJob(row);
  }

  async createAttempt(input: CreateAttemptInput): Promise<JobAttempt> {
    const rows = (await this.sql.unsafe(
      `
        insert into job_attempts (
          id,
          job_id,
          attempt_number,
          provider,
          provider_model,
          provider_job_id,
          status,
          cost_usd,
          raw_response,
          error_category,
          error_message,
          started_at,
          finished_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::timestamptz, $13::timestamptz)
        returning *
      `,
      [
        randomUUID(),
        input.jobId,
        input.attemptNumber,
        input.provider,
        input.providerModel ?? null,
        input.providerJobId ?? null,
        input.status,
        input.costUsd,
        this.sql.json((input.rawResponse ?? null) as never),
        input.errorCategory ?? null,
        input.errorMessage ?? null,
        input.startedAt,
        input.finishedAt ?? null
      ]
    )) as unknown as AttemptRow[];

    const row = rows[0];
    if (!row) {
      throw new JobConflictError(`Database did not return the created attempt for job ${input.jobId}.`);
    }
    return mapAttempt(row);
  }

  async updateAttempt(providerJobId: string, changes: Partial<JobAttempt>): Promise<JobAttempt> {
    const rows = (await this.sql.unsafe(
      `
        update job_attempts
        set
          status = case when $2::jsonb ? 'status' then $2::jsonb ->> 'status' else status end,
          cost_usd = case when $2::jsonb ? 'costUsd' then ($2::jsonb ->> 'costUsd')::numeric else cost_usd end,
          raw_response = case when $2::jsonb ? 'rawResponse' then $2::jsonb -> 'rawResponse' else raw_response end,
          error_category = case when $2::jsonb ? 'errorCategory' then $2::jsonb ->> 'errorCategory' else error_category end,
          error_message = case when $2::jsonb ? 'errorMessage' then $2::jsonb ->> 'errorMessage' else error_message end,
          finished_at = case when $2::jsonb ? 'finishedAt' then ($2::jsonb ->> 'finishedAt')::timestamptz else finished_at end
        where provider_job_id = $1
        returning *
      `,
      [providerJobId, this.sql.json(changes as never)]
    )) as unknown as AttemptRow[];

    const row = rows[0];
    if (!row) {
      throw new JobConflictError(`No attempt exists for provider job ${providerJobId}.`);
    }
    return mapAttempt(row);
  }

  async listJobTimeline(jobId: string, afterSequence = 0, limit = 100): Promise<JobTimelineEvent[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 200);
    const rows = (await this.sql.unsafe(
      `
        select *
        from job_timeline_events
        where job_id = $1 and sequence > $2
        order by sequence asc
        limit $3
      `,
      [jobId, afterSequence, boundedLimit]
    )) as unknown as TimelineRow[];

    return rows.map(mapTimelineEvent);
  }
}

function mapJob(row: JobRow): GenerationJob {
  return generationJobSchema.parse({
    id: row.id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    orchestrationMode: row.orchestration_mode,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    progress: row.progress,
    input: parseJsonObject(row.input),
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.provider_job_id ? { providerJobId: row.provider_job_id } : {}),
    ...(row.provider_model ? { providerModel: row.provider_model } : {}),
    ...(row.provider_config ? { providerConfig: parseJsonObject(row.provider_config) } : {}),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    costUsd: Number(row.cost_usd),
    ...(row.error_category ? { errorCategory: row.error_category } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.leased_by ? { leasedBy: row.leased_by } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: toIso(row.lease_expires_at) } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...(row.started_at ? { startedAt: toIso(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: toIso(row.completed_at) } : {}),
    ...(row.cancelled_at ? { cancelledAt: toIso(row.cancelled_at) } : {})
  });
}

function mapTimelineEvent(row: TimelineRow): JobTimelineEvent {
  return jobTimelineEventSchema.parse({
    id: row.id,
    sequence: Number(row.sequence),
    jobId: row.job_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    ...(row.from_status ? { fromStatus: row.from_status } : {}),
    ...(row.to_status ? { toStatus: row.to_status } : {}),
    payload: parseJsonObject(row.payload),
    createdAt: toIso(row.created_at)
  });
}

function mapAttempt(row: AttemptRow): JobAttempt {
  return jobAttemptSchema.parse({
    id: row.id,
    jobId: row.job_id,
    attemptNumber: row.attempt_number,
    provider: row.provider,
    ...(row.provider_model ? { providerModel: row.provider_model } : {}),
    ...(row.provider_job_id ? { providerJobId: row.provider_job_id } : {}),
    status: row.status,
    costUsd: Number(row.cost_usd),
    ...(row.raw_response === null ? {} : { rawResponse: row.raw_response }),
    ...(row.error_category ? { errorCategory: row.error_category } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: toIso(row.started_at),
    ...(row.finished_at ? { finishedAt: toIso(row.finished_at) } : {})
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJsonObject(value: Record<string, unknown> | string): Record<string, unknown> {
  return typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;
}
