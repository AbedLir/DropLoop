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

try {
  const bootstrap = await readFile(join(packageRoot, "test", "bootstrap-supabase.sql"), "utf8");
  await sql.unsafe(bootstrap);
  await applyMigrations(sql);

  await sql.unsafe(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on users_profile, projects, project_assets, generation_jobs, clips, review_actions, exports to authenticated;
    grant select on job_attempts to authenticated;

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

  await sql.unsafe(
    `
      insert into auth.users (id, email) values
        ($1, 'one@example.test'),
        ($2, 'two@example.test');

      insert into projects (id, user_id, name, template, screen_format, pack_size) values
        ($3, $1, 'Owner one project', 'club_night', '16:9', 12),
        ($4, $2, 'Owner two project', 'club_night', '16:9', 12);
    `,
    [userOne, userTwo, projectOne, projectTwo]
  );

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

  const claimed = await repository.claimNextJob("database-integration-worker", 60);
  assert.equal(claimed?.id, first.job.id);
  assert.equal(claimed?.leasedBy, "database-integration-worker");
  assert.equal(await repository.releaseLease(first.job.id, "database-integration-worker"), true);

  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
    const visible = (await transaction.unsafe("select id from projects order by id")) as unknown as Array<{ id: string }>;
    assert.deepEqual(visible.map((row) => row.id), [projectOne]);
  });

  console.log("Database migrations, idempotency, leasing, and project RLS verified.");
} finally {
  await sql.end();
}
