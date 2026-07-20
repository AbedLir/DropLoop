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
const providerOutputAsset = "30000000-0000-4000-8000-000000000010";
const providerOutputAnalysis = "40000000-0000-4000-8000-000000000010";
const repairSourceAsset = "30000000-0000-4000-8000-000000000020";
const repairOutputAsset = "30000000-0000-4000-8000-000000000021";
const repairSourceAnalysis = "40000000-0000-4000-8000-000000000020";
const repairOutputAnalysis = "40000000-0000-4000-8000-000000000021";
const sourceAssetPath = `${userOne}/${projectThree}/sources/${sourceAsset}/source.mp3`;

try {
  const bootstrap = await readFile(join(packageRoot, "test", "bootstrap-supabase.sql"), "utf8");
  await sql.unsafe(bootstrap);
  await applyMigrations(sql);

  await sql.unsafe(`
    grant usage on schema public, auth, storage to authenticated;
    grant select, insert, update, delete on users_profile, projects, project_assets to authenticated;
    grant select, insert on generation_jobs to authenticated;
    grant select on clips, review_actions, exports, asset_loop_analyses to authenticated;
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

  const outputJob = await repository.reserveJob({
    ...input,
    idempotencyKey: "project-one:provider-output:v1"
  });
  await repository.updateJob(outputJob.job.id, ["queued"], {
    status: "downloading",
    provider: "seedance",
    providerJobId: "provider-output-job-1",
    providerModel: "doubao-seedance-2-0-260128",
    attemptCount: 1,
    providerLatencyMs: 60000,
    progress: 70
  });
  const outputAttempt = await repository.createAttempt({
    jobId: outputJob.job.id,
    attemptNumber: 1,
    provider: "seedance",
    providerModel: "doubao-seedance-2-0-260128",
    providerJobId: "provider-output-job-1",
    status: "completed",
    costUsd: 0,
    result: { previewUrl: "https://provider.example/output.mp4" },
    latencyMs: 60000,
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T00:01:00.000Z"
  });
  const outputSha256 = "c".repeat(64);
  const outputPath = `${userOne}/${projectOne}/outputs/${outputJob.job.id}/${outputAttempt.id}/${outputSha256}.mp4`;
  await sql.unsafe("insert into storage.objects (bucket_id, name) values ('project-assets', $1)", [outputPath]);
  const registeredOutput = await repository.registerProviderOutput({
    assetId: providerOutputAsset,
    jobId: outputJob.job.id,
    attemptId: outputAttempt.id,
    ownerId: userOne,
    storageBucket: "project-assets",
    storagePath: outputPath,
    filename: `${outputSha256}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 8192,
    contentSha256: outputSha256,
    downloadLatencyMs: 4200,
    probe: {
      kind: "video",
      durationSeconds: 8,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      pixelFormat: "yuv420p",
      hasAlpha: false,
      formatName: "mov,mp4",
      audioCodec: null,
      videoCodec: "h264"
    }
  });
  assert.equal(registeredOutput.assetId, providerOutputAsset);
  assert.equal(
    registeredOutput.previewUrl,
    `/api/projects/${projectOne}/assets/${providerOutputAsset}/content`
  );
  const registeredOutputAgain = await repository.registerProviderOutput({
    assetId: providerOutputAsset,
    jobId: outputJob.job.id,
    attemptId: outputAttempt.id,
    ownerId: userOne,
    storageBucket: "project-assets",
    storagePath: outputPath,
    filename: `${outputSha256}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 8192,
    contentSha256: outputSha256,
    downloadLatencyMs: 4200,
    probe: {
      kind: "video",
      durationSeconds: 8,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      pixelFormat: "yuv420p",
      hasAlpha: false,
      formatName: "mov,mp4",
      audioCodec: null,
      videoCodec: "h264"
    }
  });
  assert.equal(registeredOutputAgain.assetId, providerOutputAsset);
  const persistedOutputJob = await repository.getJob(outputJob.job.id);
  assert.equal(persistedOutputJob?.outputAssetId, providerOutputAsset);
  assert.equal(persistedOutputJob?.providerLatencyMs, 60000);
  assert.equal(persistedOutputJob?.downloadLatencyMs, 4200);

  const claimedDownload = await repository.claimNextJob("output-download-worker", 60);
  assert.equal(claimedDownload?.id, outputJob.job.id);
  assert.equal(claimedDownload?.status, "downloading");
  await repository.releaseLease(outputJob.job.id, "output-download-worker");
  await repository.updateJob(outputJob.job.id, ["downloading"], { status: "validating", progress: 85 });
  const claimedValidation = await repository.claimNextJob("output-validation-worker", 60);
  assert.equal(claimedValidation?.id, outputJob.job.id);
  assert.equal(claimedValidation?.status, "validating");
  await repository.releaseLease(outputJob.job.id, "output-validation-worker");
  const loopResult = {
    algorithmVersion: "boundary-seam-window-gray-v3",
    decision: "pass" as const,
    loopScore: 98,
    boundaryMaePercent: 2,
    firstFrameLumaPercent: 41,
    lastFrameLumaPercent: 42,
    brightnessJumpPercent: 1,
    firstFrameBlack: false,
    lastFrameBlack: false,
    sampleFramesPerSecond: 12,
    sampledFrameCount: 96,
    blackFrameCount: 0,
    blackFrameRatioPercent: 0,
    maxAdjacentBrightnessJumpPercent: 3,
    p95AdjacentBrightnessJumpPercent: 2,
    flashReversalCount: 0,
    flashReversalsPerSecond: 0,
    brightnessSafetyScore: 94,
    flickerSafetyScore: 100,
    seamWindowFrameCount: 6,
    seamTransitionMaePercent: 2,
    seamReferenceP95MaePercent: 2,
    seamTransitionOutlierRatio: 1,
    seamJerkPercent: 2,
    seamReferenceP95JerkPercent: 2,
    seamJerkOutlierRatio: 1,
    seamContinuityScore: 100,
    reasons: [],
    policy: {
      algorithmVersion: "boundary-seam-window-gray-v3",
      frameWidth: 64,
      frameHeight: 64,
      maxBoundaryMaePercent: 12,
      maxBrightnessJumpPercent: 8,
      blackFrameLumaFloorPercent: 2,
      sampleFramesPerSecond: 12,
      maxRepresentativeFrames: 240,
      maxBlackFrameRatioPercent: 0,
      maxAdjacentBrightnessJumpPercent: 35,
      flashBrightnessDeltaPercent: 18,
      maxFlashReversalsPerSecond: 3,
      seamWindowSeconds: 0.5,
      maxSeamTransitionOutlierRatio: 2.5,
      maxSeamJerkOutlierRatio: 3
    }
  };
  const registeredAnalysis = await repository.registerLoopAnalysis({
    analysisId: providerOutputAnalysis,
    jobId: outputJob.job.id,
    assetId: providerOutputAsset,
    result: loopResult
  });
  assert.equal(registeredAnalysis.analysisId, providerOutputAnalysis);
  assert.deepEqual(registeredAnalysis.result, loopResult);
  const registeredAnalysisAgain = await repository.registerLoopAnalysis({
    analysisId: providerOutputAnalysis,
    jobId: outputJob.job.id,
    assetId: providerOutputAsset,
    result: loopResult
  });
  assert.equal(registeredAnalysisAgain.analysisId, providerOutputAnalysis);
  assert.equal((await repository.getLatestLoopAnalysis(outputJob.job.id))?.assetId, providerOutputAsset);
  await repository.updateJob(outputJob.job.id, ["validating"], { status: "awaiting_review", progress: 100 });

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
  });

  const repairSourceJob = await repository.reserveJob({
    projectId: projectThree,
    operation: "generate",
    idempotencyKey: "project-three:repair-source:v1",
    input: { prompt: { clipId: "drop-1" } }
  });
  await repository.updateJob(repairSourceJob.job.id, ["queued"], {
    status: "downloading",
    provider: "mock",
    providerJobId: "repair-source-provider-job",
    providerModel: "deterministic-contract-fixture",
    attemptCount: 1,
    progress: 70
  });
  const repairSourceAttempt = await repository.createAttempt({
    jobId: repairSourceJob.job.id,
    attemptNumber: 1,
    provider: "mock",
    providerModel: "deterministic-contract-fixture",
    providerJobId: "repair-source-provider-job",
    status: "completed",
    costUsd: 0,
    result: { previewUrl: "https://provider.example/repair-source.mp4" },
    startedAt: "2026-07-17T00:00:00.000Z",
    finishedAt: "2026-07-17T00:00:01.000Z"
  });
  const repairSourceSha = "d".repeat(64);
  const repairSourcePath = `${userOne}/${projectThree}/outputs/${repairSourceJob.job.id}/${repairSourceAttempt.id}/${repairSourceSha}.mp4`;
  await sql.unsafe("insert into storage.objects (bucket_id, name) values ('project-assets', $1)", [repairSourcePath]);
  await repository.registerProviderOutput({
    assetId: repairSourceAsset,
    jobId: repairSourceJob.job.id,
    attemptId: repairSourceAttempt.id,
    ownerId: userOne,
    storageBucket: "project-assets",
    storagePath: repairSourcePath,
    filename: `${repairSourceSha}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 8192,
    contentSha256: repairSourceSha,
    downloadLatencyMs: 1000,
    probe: {
      kind: "video", durationSeconds: 8, width: 1920, height: 1080, frameRate: 30,
      codec: "h264", pixelFormat: "yuv420p", hasAlpha: false, formatName: "mov,mp4",
      audioCodec: null, videoCodec: "h264"
    }
  });
  await repository.updateJob(repairSourceJob.job.id, ["downloading"], { status: "validating", progress: 85 });
  const repairRequiredResult = {
    ...loopResult,
    decision: "repair_required" as const,
    loopScore: 65,
    boundaryMaePercent: 35,
    firstFrameLumaPercent: 30,
    lastFrameLumaPercent: 55,
    brightnessJumpPercent: 25,
    reasons: ["Boundary MAE 35% exceeds 12%.", "Boundary brightness jump 25% exceeds 8%."]
  };
  await repository.registerLoopAnalysis({
    analysisId: repairSourceAnalysis,
    jobId: repairSourceJob.job.id,
    assetId: repairSourceAsset,
    result: repairRequiredResult
  });
  await repository.updateJob(repairSourceJob.job.id, ["validating"], { status: "awaiting_review", progress: 100 });

  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);

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

  const repairJob = await repository.getJob(reviewJobId);
  assert.equal(repairJob?.sourceAssetId, repairSourceAsset);
  assert.equal(repairJob?.sourceAnalysisId, repairSourceAnalysis);
  assert.equal(repairJob?.input.sourceAssetId, repairSourceAsset);
  assert.equal(repairJob?.input.sourceAnalysisId, repairSourceAnalysis);

  await repository.updateJob(reviewJobId, ["queued"], {
    status: "repairing",
    provider: "loop-doctor-local",
    providerJobId: `local-loop-doctor:${reviewJobId}:cyclic-boundary-crossfade-v1`,
    providerModel: "cyclic-boundary-crossfade-v1",
    attemptCount: 1,
    progress: 10
  });
  const boundRepairSource = await repository.getRepairSource(reviewJobId);
  assert.deepEqual(boundRepairSource, {
    assetId: repairSourceAsset,
    jobId: reviewJobId,
    projectId: projectThree,
    sourceAnalysisId: repairSourceAnalysis,
    storageBucket: "project-assets",
    storagePath: repairSourcePath,
    filename: `${repairSourceSha}.mp4`,
    durationSeconds: 8,
    frameRate: 30,
    hasAlpha: false
  });

  await repository.updateJob(reviewJobId, ["repairing"], {
    status: "downloading",
    provider: "mock",
    providerJobId: "repair-output-provider-job",
    providerModel: "deterministic-contract-fixture",
    progress: 70
  });
  const repairOutputAttempt = await repository.createAttempt({
    jobId: reviewJobId,
    attemptNumber: 1,
    provider: "mock",
    providerModel: "deterministic-contract-fixture",
    providerJobId: "repair-output-provider-job",
    status: "completed",
    costUsd: 0,
    result: { previewUrl: "https://provider.example/repair-output.mp4" },
    startedAt: "2026-07-17T00:01:00.000Z",
    finishedAt: "2026-07-17T00:01:01.000Z"
  });
  const repairOutputSha = "e".repeat(64);
  const repairOutputPath = `${userOne}/${projectThree}/outputs/${reviewJobId}/${repairOutputAttempt.id}/${repairOutputSha}.mp4`;
  await sql.unsafe("insert into storage.objects (bucket_id, name) values ('project-assets', $1)", [repairOutputPath]);
  await repository.registerProviderOutput({
    assetId: repairOutputAsset,
    jobId: reviewJobId,
    attemptId: repairOutputAttempt.id,
    ownerId: userOne,
    storageBucket: "project-assets",
    storagePath: repairOutputPath,
    filename: `${repairOutputSha}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 8192,
    contentSha256: repairOutputSha,
    downloadLatencyMs: 1000,
    probe: {
      kind: "video", durationSeconds: 8, width: 1920, height: 1080, frameRate: 30,
      codec: "h264", pixelFormat: "yuv420p", hasAlpha: false, formatName: "mov,mp4",
      audioCodec: null, videoCodec: "h264"
    }
  });
  await repository.updateJob(reviewJobId, ["downloading"], { status: "validating", progress: 85 });
  const storedRepairAnalysis = await repository.registerLoopAnalysis({
    analysisId: repairOutputAnalysis,
    jobId: reviewJobId,
    assetId: repairOutputAsset,
    result: loopResult
  });
  assert.equal(storedRepairAnalysis.sourceAnalysisId, repairSourceAnalysis);
  await repository.updateJob(reviewJobId, ["validating"], { status: "awaiting_review", progress: 100 });

  const repairLineage = (await sql.unsafe(
    `
      select
        output_asset.parent_asset_id,
        output_asset.version,
        output_analysis.source_analysis_id,
        target_clip.current_asset_id
      from project_assets as output_asset
      join asset_loop_analyses as output_analysis on output_analysis.asset_id = output_asset.id
      join clips as target_clip on target_clip.project_id = output_asset.project_id
        and target_clip.planned_clip_id = output_asset.planned_clip_id
      where output_asset.id = $1 and output_analysis.id = $2
    `,
    [repairOutputAsset, repairOutputAnalysis]
  )) as unknown as Array<{
    parent_asset_id: string;
    version: number;
    source_analysis_id: string;
    current_asset_id: string;
  }>;
  assert.deepEqual(repairLineage[0], {
    parent_asset_id: repairSourceAsset,
    version: 2,
    source_analysis_id: repairSourceAnalysis,
    current_asset_id: repairOutputAsset
  });

  let resolumeExportId = "";
  let resolumeExportJobId = "";
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction.unsafe("select set_config('request.jwt.claim.sub', $1, true)", [userOne]);
    const finalApproval = (await transaction.unsafe(
      "select * from apply_clip_review_action($1, $2, 'approve', 'Loop Doctor v3 accepted', $3)",
      [projectThree, persistedClipId, "web-review:approve-after-repair"]
    )) as unknown as Array<{ review_status: string; clip_status: string }>;
    assert.deepEqual(finalApproval[0], { review_status: "approved", clip_status: "approved" });

    const requested = (await transaction.unsafe(
      "select * from request_resolume_export($1, $2, $3)",
      [projectThree, persistedClipId, "web-export:resolume:one"]
    )) as unknown as Array<{ export_id: string; job_id: string; status: string }>;
    resolumeExportId = requested[0]?.export_id ?? "";
    resolumeExportJobId = requested[0]?.job_id ?? "";
    assert.ok(resolumeExportId);
    assert.ok(resolumeExportJobId);
    assert.equal(requested[0]?.status, "queued");

    const duplicate = (await transaction.unsafe(
      "select * from request_resolume_export($1, $2, $3)",
      [projectThree, persistedClipId, "web-export:resolume:one"]
    )) as unknown as Array<{ export_id: string; job_id: string }>;
    assert.deepEqual(duplicate[0], { export_id: resolumeExportId, job_id: resolumeExportJobId });
  });

  await repository.updateJob(resolumeExportJobId, ["queued"], {
    status: "exporting",
    provider: "resolume-export-local",
    providerJobId: `local-resolume-export:${resolumeExportJobId}:resolume-prores-4444-v1`,
    providerModel: "resolume-prores-4444-v1",
    providerConfig: { algorithmVersion: "resolume-prores-4444-v1" },
    attemptCount: 1,
    progress: 10
  });
  const resolumeSource = await repository.getResolumeExportSource(resolumeExportJobId);
  assert.equal(resolumeSource?.assetId, repairOutputAsset);
  assert.equal(resolumeSource?.sourceAnalysisId, repairOutputAnalysis);
  assert.equal(resolumeSource?.loopEvidence.algorithmVersion, "boundary-seam-window-gray-v3");

  const resolumeRoot = `${userOne}/${projectThree}/exports/${resolumeExportId}/`;
  const resolumeMediaPath = `${resolumeRoot}media/${"f".repeat(64)}.mov`;
  const resolumeManifestPath = `${resolumeRoot}manifest.json`;
  await sql.unsafe("insert into storage.objects (bucket_id, name) values ('project-assets', $1), ('project-assets', $2)", [
    resolumeMediaPath,
    resolumeManifestPath
  ]);
  await repository.completeResolumeExport({
    exportId: resolumeExportId,
    jobId: resolumeExportJobId,
    ownerId: userOne,
    packageStoragePath: resolumeRoot,
    mediaStoragePath: resolumeMediaPath,
    manifestStoragePath: resolumeManifestPath,
    manifest: {
      schemaVersion: "resolume-delivery-v1",
      exportId: resolumeExportId,
      projectId: projectThree,
      jobId: resolumeExportJobId,
      preset: "resolume",
      deliveryState: "ready_for_manual_resolume_import",
      source: {
        assetId: repairOutputAsset,
        sourceAnalysisId: repairOutputAnalysis,
        contentSha256: repairOutputSha,
        filename: `${repairOutputSha}.mp4`,
        hasAlpha: false
      },
      media: {
        filename: `${"f".repeat(64)}.mov`,
        storagePath: resolumeMediaPath,
        mimeType: "video/quicktime",
        codec: "prores",
        pixelFormat: "yuv444p12le",
        hasAlpha: false,
        durationSeconds: 8,
        width: 1920,
        height: 1080,
        frameRate: 30
      },
      loopEvidence: {
        algorithmVersion: "boundary-seam-window-gray-v3",
        decision: "pass",
        seamContinuityScore: 100,
        brightnessSafetyScore: 94,
        flickerSafetyScore: 100
      },
      operatorNotes: ["Fixture delivery"],
      unresolvedAcceptance: ["Manual Resolume import remains required."]
    }
  });
  const completedResolume = (await sql.unsafe(
    "select status, storage_bucket, storage_path, manifest #>> '{media,storagePath}' as media_path from exports where id = $1",
    [resolumeExportId]
  )) as unknown as Array<{ status: string; storage_bucket: string; storage_path: string; media_path: string }>;
  assert.deepEqual(completedResolume[0], {
    status: "completed",
    storage_bucket: "project-assets",
    storage_path: resolumeRoot,
    media_path: resolumeMediaPath
  });
  assert.equal((await repository.getJob(resolumeExportJobId))?.status, "completed");

  const reviewCounts = (await sql.unsafe(
    `
      select
        (select count(*)::integer from review_actions where project_id = $1) as action_count,
        (select count(*)::integer from generation_jobs where id = $2) as job_count,
        (select count(*)::integer from job_timeline_events where job_id = $2 and event_type = 'job_reserved') as timeline_count
    `,
    [projectThree, reviewJobId]
  )) as unknown as Array<{ action_count: number; job_count: number; timeline_count: number }>;
  assert.deepEqual(reviewCounts[0], { action_count: 2, job_count: 1, timeline_count: 1 });

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
    assert.deepEqual(visibleAssets.map((row) => row.id), [
      sourceAsset,
      providerOutputAsset,
      repairSourceAsset,
      repairOutputAsset
    ]);

    const visibleTimeline = (await transaction.unsafe(
      "select distinct job_id from job_timeline_events order by job_id"
    )) as unknown as Array<{ job_id: string }>;
    assert.equal(visibleTimeline.some((row) => row.job_id === foreignJob.job.id), false);
    assert.equal(visibleTimeline.some((row) => row.job_id === first.job.id), true);

    const visibleAnalyses = (await transaction.unsafe(
      "select id from asset_loop_analyses order by id"
    )) as unknown as Array<{ id: string }>;
    assert.deepEqual(visibleAnalyses.map((row) => row.id), [
      providerOutputAnalysis,
      repairSourceAnalysis,
      repairOutputAnalysis
    ]);
  });

  console.log(
    "Database migrations, private immutable source/provider outputs, decoded before/after repair lineage, BPM provenance, project/review persistence, idempotency, dependency-aware leasing, timeline, and project RLS verified."
  );
} finally {
  await sql.end();
}
