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
const projectThree = "10000000-0000-4000-8000-000000000003";
const pipelineWorkflow = "20000000-0000-4000-8000-000000000001";
const sourceAsset = "30000000-0000-4000-8000-000000000001";
const sourceAssetPath = `${userOne}/${projectThree}/sources/${sourceAsset}/source.mp3`;

try {
  const bootstrap = await readFile(join(packageRoot, "test", "bootstrap-supabase.sql"), "utf8");
  await sql.unsafe(bootstrap);
  await applyMigrations(sql);

  await sql.unsafe(`
    grant usage on schema public, auth, storage to authenticated;
    grant select, insert, update, delete on users_profile, projects, project_assets to authenticated;
    grant select, insert on generation_jobs to authenticated;
    grant select on clips, review_actions, exports to authenticated;
    grant select on job_attempts, job_dependencies, job_timeline_events to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;

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
        insert into projects (id, user_id, creation_key, name, template, screen_format, pack_size) values
          ($1, $2, 'fixture:owner-one', 'Owner one project', 'club_night', '16:9', 12),
          ($3, $4, 'fixture:owner-two', 'Owner two project', 'club_night', '16:9', 12)
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

  let persistedClipId = "";
  let reviewJobId = "";
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);

    const createdProjects = (await transaction.unsafe(
      `
        select id, user_id, creation_key
        from create_project_with_clips(
          $1,
          $2,
          'Persisted Web project',
          'club_night',
          'warehouse techno',
          132,
          '16:9',
          12,
          'steel tunnels and red haze',
          'club LED wall',
          $3::jsonb,
          $4::jsonb
        )
      `,
      [
        projectThree,
        "web-project:create:one",
        transaction.json({ brief: { projectName: "Persisted Web project" }, clips: [], stageResults: [] } as never),
        transaction.json([
          {
            planned_clip_id: "drop-1",
            role: "drop",
            energy: 92,
            status: "generated",
            preview_url: "/mock/clips/drop-1.mp4",
            thumbnail_url: "/mock/thumbnails/drop-1.jpg",
            duration_seconds: 8,
            loop_score: 90,
            quality_score: 88,
            review_recommended_action: "approve",
            review_reason: "Passes automated gates; awaiting human judgment."
          }
        ] as never)
      ]
    )) as unknown as Array<{ id: string; user_id: string; creation_key: string }>;

    assert.equal(createdProjects[0]?.id, projectThree);
    assert.equal(createdProjects[0]?.user_id, userOne);

    const duplicateProjects = (await transaction.unsafe(
      `
        select id
        from create_project_with_clips(
          $1,
          $2,
          'Persisted Web project',
          'club_night',
          'warehouse techno',
          132,
          '16:9',
          12,
          'steel tunnels and red haze',
          'club LED wall',
          '{}'::jsonb,
          '[]'::jsonb
        )
      `,
      [projectThree, "web-project:create:one"]
    )) as unknown as Array<{ id: string }>;
    assert.equal(duplicateProjects[0]?.id, projectThree);

    await transaction.unsafe("insert into storage.objects (bucket_id, name) values ('project-assets', $1)", [
      sourceAssetPath
    ]);
    const registeredAssets = (await transaction.unsafe(
      `
        select
          id,
          role,
          codec,
          duration_seconds,
          content_sha256,
          bpm_analyzed::double precision as bpm_analyzed,
          bpm_confidence::double precision as bpm_confidence,
          bpm_analysis_version,
          beat_grid_assumption
        from register_project_asset(
          $1::uuid,
          $2::uuid,
          'audio',
          'source_audio',
          $3,
          'source.mp3',
          'audio/mpeg',
          4096,
          $4,
          61.25,
          null,
          null,
          null,
          'mp3',
          null,
          null,
          $5::jsonb
        )
      `,
      [
        sourceAsset,
        projectThree,
        sourceAssetPath,
        "a".repeat(64),
        transaction.json({
          probe: { kind: "audio", durationSeconds: 61.25, codec: "mp3" },
          bpmAnalysis: {
            analyzedBpm: 128.4,
            confidence: 0.82,
            windowSeconds: 61.25,
            sampleRate: 11025,
            algorithmVersion: "onset-autocorrelation-v1",
            beatGridAssumption: "constant-tempo-double-time-tie-break"
          }
        } as never)
      ]
    )) as unknown as Array<{
      id: string;
      role: string;
      codec: string;
      duration_seconds: number;
      content_sha256: string;
      bpm_analyzed: number;
      bpm_confidence: number;
      bpm_analysis_version: string;
      beat_grid_assumption: string;
    }>;
    assert.deepEqual(registeredAssets[0], {
      id: sourceAsset,
      role: "source_audio",
      codec: "mp3",
      duration_seconds: 61.25,
      content_sha256: "a".repeat(64),
      bpm_analyzed: 128.4,
      bpm_confidence: 0.82,
      bpm_analysis_version: "onset-autocorrelation-v1",
      beat_grid_assumption: "constant-tempo-double-time-tie-break"
    });

    const syncedBpm = (await transaction.unsafe(
      `
        select
          bpm,
          bpm_source,
          bpm_analyzed::double precision as bpm_analyzed,
          bpm_confidence::double precision as bpm_confidence,
          bpm_analyzed_asset_id
        from projects where id = $1
      `,
      [projectThree]
    )) as unknown as Array<{
      bpm: number;
      bpm_source: string;
      bpm_analyzed: number;
      bpm_confidence: number;
      bpm_analyzed_asset_id: string;
    }>;
    assert.deepEqual(syncedBpm[0], {
      bpm: 132,
      bpm_source: "manual_override",
      bpm_analyzed: 128.4,
      bpm_confidence: 0.82,
      bpm_analyzed_asset_id: sourceAsset
    });

    const analysisSelection = (await transaction.unsafe(
      `
        select bpm, bpm_source
        from set_project_bpm_selection($1, 128, 'analysis', $2)
      `,
      [projectThree, sourceAsset]
    )) as unknown as Array<{ bpm: number; bpm_source: string }>;
    assert.deepEqual(analysisSelection[0], { bpm: 128, bpm_source: "analysis" });

    const manualSelection = (await transaction.unsafe(
      `
        select bpm, bpm_source
        from set_project_bpm_selection($1, 132, 'manual_override', $2)
      `,
      [projectThree, sourceAsset]
    )) as unknown as Array<{ bpm: number; bpm_source: string }>;
    assert.deepEqual(manualSelection[0], { bpm: 132, bpm_source: "manual_override" });

    const duplicateAssets = (await transaction.unsafe(
      `
        select id
        from register_project_asset(
          $1::uuid, $2::uuid, 'audio', 'source_audio', $3, 'source.mp3', 'audio/mpeg', 4096, $4,
          61.25, null, null, null, 'mp3', null, null, '{}'::jsonb
        )
      `,
      [sourceAsset, projectThree, sourceAssetPath, "a".repeat(64)]
    )) as unknown as Array<{ id: string }>;
    assert.equal(duplicateAssets[0]?.id, sourceAsset);

    const clips = (await transaction.unsafe(
      "select id, status from clips where project_id = $1 and planned_clip_id = 'drop-1'",
      [projectThree]
    )) as unknown as Array<{ id: string; status: string }>;
    persistedClipId = clips[0]?.id ?? "";
    assert.ok(persistedClipId);
    assert.equal(clips[0]?.status, "generated");

    const firstReview = (await transaction.unsafe(
      "select * from apply_clip_review_action($1, $2, 'repair', 'Visible loop seam', $3)",
      [projectThree, persistedClipId, "web-review:repair:one"]
    )) as unknown as Array<{
      review_status: string;
      clip_status: string;
      job_id: string;
    }>;
    assert.equal(firstReview[0]?.review_status, "repair_requested");
    assert.equal(firstReview[0]?.clip_status, "repairing");
    reviewJobId = firstReview[0]?.job_id ?? "";
    assert.ok(reviewJobId);

    const duplicateReview = (await transaction.unsafe(
      "select * from apply_clip_review_action($1, $2, 'repair', 'Visible loop seam', $3)",
      [projectThree, persistedClipId, "web-review:repair:one"]
    )) as unknown as Array<{ job_id: string }>;
    assert.equal(duplicateReview[0]?.job_id, reviewJobId);
  });

  const reviewCounts = (await sql.unsafe(
    `
      select
        (select count(*)::integer from review_actions where project_id = $1) as action_count,
        (select count(*)::integer from generation_jobs where id = $2) as job_count,
        (select count(*)::integer from job_timeline_events where job_id = $2 and event_type = 'job_reserved') as timeline_count
    `,
    [projectThree, reviewJobId]
  )) as unknown as Array<{ action_count: number; job_count: number; timeline_count: number }>;
  assert.deepEqual(reviewCounts[0], { action_count: 1, job_count: 1, timeline_count: 1 });

  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
      await transaction.unsafe(
        "select * from apply_clip_review_action($1, $2, 'approve', '', 'web-review:approve:while-repairing')",
        [projectThree, persistedClipId]
      );
    }),
    /clip already has an active durable job/
  );

  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userTwo]);
      await transaction.unsafe(
        "select * from apply_clip_review_action($1, $2, 'approve', '', 'web-review:foreign')",
        [projectThree, persistedClipId]
      );
    }),
    /clip not found for authenticated project owner/
  );

  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userTwo]);
      await transaction.unsafe(
        `
          select * from register_project_asset(
            $1::uuid, $2::uuid, 'audio', 'source_audio', $3, 'foreign.mp3', 'audio/mpeg', 4096, $4,
            61.25, null, null, null, 'mp3', null, null, '{}'::jsonb
          )
        `,
        ["30000000-0000-4000-8000-000000000002", projectThree, sourceAssetPath, "b".repeat(64)]
      );
    }),
    /project not found for authenticated owner/
  );

  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userTwo]);
      await transaction.unsafe("select * from set_project_bpm_selection($1, 128, 'analysis', $2)", [
        projectThree,
        sourceAsset
      ]);
    }),
    /project not found for authenticated owner/
  );

  await assert.rejects(
    sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
      await transaction.unsafe(
        `
          insert into project_assets (
            project_id, type, role, url, filename, mime_type, size_bytes, codec, duration_seconds
          ) values ($1, 'audio', 'source_audio', 'forged', 'forged.mp3', 'audio/mpeg', 1, 'mp3', 1)
        `,
        [projectThree]
      );
    }),
    /row-level security policy/
  );

  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
    const overwritten = (await transaction.unsafe(
      "update storage.objects set name = name || '.changed' where name = $1 returning name",
      [sourceAssetPath]
    )) as unknown as Array<{ name: string }>;
    assert.equal(overwritten.length, 0);
  });

  const immutableStorageObjects = (await sql.unsafe(
    "select name from storage.objects where name = $1",
    [sourceAssetPath]
  )) as unknown as Array<{ name: string }>;
  assert.equal(immutableStorageObjects.length, 1);
  assert.equal(immutableStorageObjects[0]?.name, sourceAssetPath);

  const foreignJob = await repository.reserveJob({
    ...input,
    projectId: projectTwo,
    idempotencyKey: "project-two:private-job"
  });

  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
    const visible = (await transaction.unsafe("select id from projects order by id")) as unknown as Array<{ id: string }>;
    assert.deepEqual(visible.map((row) => row.id), [projectOne, projectThree]);

    const visibleAssets = (await transaction.unsafe(
      "select id from project_assets order by id"
    )) as unknown as Array<{ id: string }>;
    assert.deepEqual(visibleAssets.map((row) => row.id), [sourceAsset]);

    const visibleTimeline = (await transaction.unsafe(
      "select distinct job_id from job_timeline_events order by job_id"
    )) as unknown as Array<{ job_id: string }>;
    assert.equal(visibleTimeline.some((row) => row.job_id === foreignJob.job.id), false);
    assert.equal(visibleTimeline.some((row) => row.job_id === first.job.id), true);
  });

  console.log(
    "Database migrations, private immutable asset registration, BPM provenance, project/review persistence, idempotency, dependency-aware leasing, timeline, and project RLS verified."
  );
} finally {
  await sql.end();
}
