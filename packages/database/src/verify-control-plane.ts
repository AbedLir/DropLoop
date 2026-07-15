import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "./migrations";
import { createDatabaseClient } from "./postgres-client";
import { PostgresDurableJobRepository } from "./postgres-job-repository";

const sql = createDatabaseClient();
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userOne = "00000000-0000-4000-8000-000000000001";
const userTwo = "00000000-0000-4000-8000-000000000002";
const projectOne = "10000000-0000-4000-8000-000000000001";
const projectTwo = "10000000-0000-4000-8000-000000000002";
const pipelineWorkflow = "20000000-0000-4000-8000-000000000001";

try {
  const bootstrap = await readFile(join(packageRoot, "test", "bootstrap-supabase.sql"), "utf8");
  await sql.unsafe(bootstrap);
  await applyMigrations(sql);

  await sql.unsafe(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on users_profile, projects, project_assets, generation_jobs, clips, review_actions, exports to authenticated;
    grant select on job_attempts, job_dependencies, job_timeline_events to authenticated;

    delete from job_timeline_events;
    delete from job_dependencies;
    delete from review_actions;
    delete from job_attempts;
    delete from exports;
    delete from clips;
    delete from generation_jobs;
    delete from project_assets;
    delete from projects;
    delete from users_profile;
    delete from auth.users;
  `);

  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      `
        insert into auth.users (id, email) values
          ($1, 'one@example.test'),
          ($2, 'two@example.test')
      `,
      [userOne, userTwo]
    );
    await transaction.unsafe(
      `
        insert into projects (id, user_id, name, template, screen_format, pack_size) values
          ($1, $2, 'Owner one project', 'club_night', '16:9', 12),
          ($3, $4, 'Owner two project', 'club_night', '16:9', 12)
      `,
      [projectOne, userOne, projectTwo, userTwo]
    );
  });

  const repository = new PostgresDurableJobRepository(sql);
  const input = {
    projectId: projectOne,
    operation: "generate" as const,
    idempotencyKey: "project-one:drop-1:v1",
    input: { prompt: { clipId: "drop-1" } },
    maxAttempts: 3
  };
  const first = await repository.reserveJob(input);
  const duplicate = await repository.reserveJob(input);

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, first.job.id);
  await assert.rejects(repository.reserveJob({ ...input, orchestrationMode: "split" }), /different workflow topology/);

  const reservationTimeline = await repository.listJobTimeline(first.job.id);
  assert.deepEqual(reservationTimeline.map((event) => event.eventType), ["job_reserved"]);

  const claimed = await repository.claimNextJob("database-integration-worker", 60);
  assert.equal(claimed?.id, first.job.id);
  assert.equal(claimed?.leasedBy, "database-integration-worker");
  assert.equal(await repository.releaseLease(first.job.id, "database-integration-worker"), true);
  await repository.updateJob(first.job.id, ["queued"], {
    status: "completed",
    progress: 100,
    completedAt: new Date().toISOString()
  });

  const pipelineFirst = await repository.reserveJob({
    ...input,
    workflowId: pipelineWorkflow,
    orchestrationMode: "pipeline",
    idempotencyKey: "project-one:pipeline:first"
  });
  const pipelineSecond = await repository.reserveJob({
    ...input,
    workflowId: pipelineWorkflow,
    orchestrationMode: "pipeline",
    dependsOnJobIds: [pipelineFirst.job.id],
    idempotencyKey: "project-one:pipeline:second"
  });

  const claimedPipelineFirst = await repository.claimNextJob("pipeline-worker-one", 60);
  assert.equal(claimedPipelineFirst?.id, pipelineFirst.job.id);
  assert.equal(await repository.claimNextJob("pipeline-worker-two", 60), null);

  await repository.updateJob(pipelineFirst.job.id, ["queued"], {
    status: "completed",
    progress: 100,
    completedAt: new Date().toISOString()
  });

  const claimedPipelineSecond = await repository.claimNextJob("pipeline-worker-two", 60);
  assert.equal(claimedPipelineSecond?.id, pipelineSecond.job.id);
  assert.equal(await repository.releaseLease(pipelineSecond.job.id, "pipeline-worker-two"), true);

  const pipelineTimeline = await repository.listJobTimeline(pipelineSecond.job.id);
  assert.deepEqual(pipelineTimeline.map((event) => event.eventType), [
    "job_reserved",
    "dependency_added",
    "lease_claimed",
    "lease_released"
  ]);

  await assert.rejects(
    sql.unsafe("insert into job_dependencies (job_id, depends_on_job_id) values ($1, $2)", [
      pipelineFirst.job.id,
      pipelineSecond.job.id
    ]),
    /cycle/
  );

  const foreignJob = await repository.reserveJob({
    ...input,
    projectId: projectTwo,
    idempotencyKey: "project-two:private-job"
  });

  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
    const visible = (await transaction.unsafe("select id from projects order by id")) as unknown as Array<{ id: string }>;
    assert.deepEqual(visible.map((row) => row.id), [projectOne]);

    const visibleTimeline = (await transaction.unsafe(
      "select distinct job_id from job_timeline_events order by job_id"
    )) as unknown as Array<{ job_id: string }>;
    assert.equal(visibleTimeline.some((row) => row.job_id === foreignJob.job.id), false);
    assert.equal(visibleTimeline.some((row) => row.job_id === first.job.id), true);
  });

  console.log("Database migrations, idempotency, dependency-aware leasing, timeline, and project RLS verified.");
} finally {
  await sql.end();
}
