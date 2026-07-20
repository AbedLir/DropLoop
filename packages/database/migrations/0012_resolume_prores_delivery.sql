alter table exports
  add column if not exists clip_id uuid references clips(id) on delete set null,
  add column if not exists source_asset_id uuid references project_assets(id) on delete restrict,
  add column if not exists source_analysis_id uuid references asset_loop_analyses(id) on delete restrict,
  add column if not exists idempotency_key text;

create unique index if not exists exports_project_idempotency_key
  on exports (project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists exports_job_id on exports (job_id);
create index if not exists exports_source_lineage on exports (source_asset_id, source_analysis_id)
  where source_asset_id is not null and source_analysis_id is not null;

create or replace function bind_repair_job_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_clip clips%rowtype;
  target_asset project_assets%rowtype;
  target_analysis asset_loop_analyses%rowtype;
  requested_clip_id uuid;
  requested_asset_id uuid;
  requested_analysis_id uuid;
begin
  if new.operation not in ('repair', 'export') then
    if new.source_asset_id is not null or new.source_analysis_id is not null then
      raise exception 'only repair and export jobs may bind source asset lineage';
    end if;
    return new;
  end if;

  requested_clip_id := nullif(new.input ->> 'clipId', '')::uuid;
  requested_asset_id := coalesce(new.source_asset_id, nullif(new.input ->> 'sourceAssetId', '')::uuid);
  requested_analysis_id := coalesce(new.source_analysis_id, nullif(new.input ->> 'sourceAnalysisId', '')::uuid);

  if new.operation = 'export' and requested_clip_id is null then
    raise exception 'export job requires a project clip';
  end if;

  if requested_clip_id is not null then
    select candidate_clip.* into target_clip
    from clips as candidate_clip
    where candidate_clip.id = requested_clip_id
      and candidate_clip.project_id = new.project_id;
    if not found then
      raise exception 'repair or export clip does not belong to job project' using errcode = '42501';
    end if;
    requested_asset_id := coalesce(requested_asset_id, target_clip.current_asset_id);
    if target_clip.current_asset_id is null or requested_asset_id <> target_clip.current_asset_id then
      raise exception 'repair or export job must bind the clip current immutable asset';
    end if;
    if new.operation = 'export' and target_clip.status <> 'approved' then
      raise exception 'export requires a human-approved clip';
    end if;
  end if;

  if requested_asset_id is null then
    raise exception 'repair or export job requires an immutable source asset';
  end if;
  select candidate_asset.* into target_asset
  from project_assets as candidate_asset
  where candidate_asset.id = requested_asset_id
    and candidate_asset.project_id = new.project_id
    and candidate_asset.role = 'generated_output'
    and candidate_asset.status = 'ready';
  if not found then
    raise exception 'repair or export source must be a ready generated output in the job project' using errcode = '42501';
  end if;

  if requested_analysis_id is null then
    select candidate_analysis.id into requested_analysis_id
    from asset_loop_analyses as candidate_analysis
    where candidate_analysis.asset_id = requested_asset_id
    order by candidate_analysis.created_at desc, candidate_analysis.id desc
    limit 1;
  end if;
  if requested_analysis_id is null then
    raise exception 'repair or export job requires persisted source loop evidence';
  end if;
  select candidate_analysis.* into target_analysis
  from asset_loop_analyses as candidate_analysis
  where candidate_analysis.id = requested_analysis_id
    and candidate_analysis.asset_id = requested_asset_id;
  if not found then
    raise exception 'repair or export source analysis does not belong to source asset' using errcode = '42501';
  end if;
  if exists (
    select 1
    from asset_loop_analyses as newer_analysis
    where newer_analysis.asset_id = requested_asset_id
      and (newer_analysis.created_at, newer_analysis.id) > (target_analysis.created_at, target_analysis.id)
  ) then
    raise exception 'repair or export job must bind the latest source loop evidence';
  end if;
  if new.operation = 'export' and (
    target_analysis.algorithm_version <> 'boundary-seam-window-gray-v3'
    or target_analysis.decision <> 'pass'
  ) then
    raise exception 'export requires current passing seam-window loop evidence';
  end if;

  new.source_asset_id := requested_asset_id;
  new.source_analysis_id := requested_analysis_id;
  new.input := coalesce(new.input, '{}'::jsonb) || jsonb_build_object(
    'sourceAssetId', requested_asset_id,
    'sourceAnalysisId', requested_analysis_id,
    'sourceAssetVersion', target_asset.version,
    'sourceAnalysisVersion', target_analysis.algorithm_version
  );
  return new;
end;
$$;

-- A local repair reaches `awaiting_review` only after it has created a new
-- immutable candidate and its machine evidence.  That state must not prevent
-- the human from recording the final decision on the candidate.  Resolve the
-- completed review cycle before evaluating a new action, while still blocking
-- genuinely in-flight work for the same clip.
create or replace function apply_clip_review_action(
  p_project_id uuid,
  p_clip_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text
)
returns table (
  clip_id uuid,
  action text,
  review_status text,
  clip_status text,
  reason text,
  job_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  selected_clip clips%rowtype;
  existing_action review_actions%rowtype;
  created_action review_actions%rowtype;
  resulting_clip_status text;
  resulting_review_status text;
  created_job_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('approve', 'reject', 'repair', 'regenerate') then
    raise exception 'unsupported review action';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'review idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('review:' || current_user_id::text || ':' || p_idempotency_key, 0)
  );

  select review.*
    into existing_action
  from review_actions review
  where review.user_id = current_user_id
    and review.idempotency_key = p_idempotency_key;

  if found then
    if existing_action.project_id <> p_project_id
      or existing_action.clip_id <> p_clip_id
      or existing_action.action <> p_action then
      raise exception 'review idempotency key belongs to a different action';
    end if;

    select job.id
      into created_job_id
    from generation_jobs job
    where job.project_id = p_project_id
      and job.idempotency_key = 'review:' || existing_action.id::text;

    return query
    select
      existing_action.clip_id,
      existing_action.action,
      case existing_action.action
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'repair' then 'repair_requested'
        else 'regenerate_requested'
      end,
      persisted_clip.status,
      existing_action.reason,
      created_job_id,
      existing_action.created_at
    from clips persisted_clip
    where persisted_clip.id = existing_action.clip_id;
    return;
  end if;

  select clip.*
    into selected_clip
  from clips clip
  join projects project on project.id = clip.project_id
  where clip.id = p_clip_id
    and clip.project_id = p_project_id
    and project.user_id = current_user_id
  for update of clip;

  if not found then
    raise exception 'clip not found for authenticated project owner' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from generation_jobs job
    where job.project_id = p_project_id
      and job.input ->> 'clipId' = p_clip_id::text
      and job.status not in ('completed', 'failed', 'cancelled', 'awaiting_review')
  ) then
    raise exception 'clip already has an active durable job';
  end if;

  resulting_review_status := case p_action
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    when 'repair' then 'repair_requested'
    else 'regenerate_requested'
  end;

  resulting_clip_status := case p_action
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    when 'repair' then 'repairing'
    else 'queued'
  end;

  insert into review_actions (
    project_id,
    clip_id,
    user_id,
    action,
    reason,
    idempotency_key
  )
  values (
    p_project_id,
    p_clip_id,
    current_user_id,
    p_action,
    coalesce(nullif(trim(p_reason), ''), 'Human review action: ' || p_action),
    p_idempotency_key
  )
  returning * into created_action;

  update clips
  set status = resulting_clip_status
  where id = p_clip_id;

  update generation_jobs
  set status = 'completed',
      progress = 100,
      completed_at = coalesce(completed_at, now()),
      error_category = null,
      error_message = null
  where project_id = p_project_id
    and input ->> 'clipId' = p_clip_id::text
    and status = 'awaiting_review';

  if p_action in ('repair', 'regenerate') then
    created_job_id := uuid_generate_v4();

    insert into generation_jobs (
      id,
      project_id,
      stage,
      operation,
      idempotency_key,
      status,
      progress,
      input,
      workflow_id,
      orchestration_mode
    )
    values (
      created_job_id,
      p_project_id,
      case when p_action = 'repair' then 'loop_doctor' else 'generate_video' end,
      case when p_action = 'repair' then 'repair' else 'generate' end,
      'review:' || created_action.id::text,
      'queued',
      0,
      jsonb_build_object(
        'clipId', p_clip_id,
        'plannedClipId', selected_clip.planned_clip_id,
        'reviewActionId', created_action.id,
        'requestedBy', current_user_id
      ),
      created_job_id,
      'solo'
    );

    update projects
    set status = 'generating'
    where id = p_project_id;
  else
    update projects
    set status = 'reviewing'
    where id = p_project_id;
  end if;

  return query
  select
    p_clip_id,
    p_action,
    resulting_review_status,
    resulting_clip_status,
    created_action.reason,
    created_job_id,
    created_action.created_at;
end;
$$;

create or replace function request_resolume_export(
  p_project_id uuid,
  p_clip_id uuid,
  p_idempotency_key text
)
returns table (
  export_id uuid,
  job_id uuid,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_clip clips%rowtype;
  target_asset project_assets%rowtype;
  target_analysis asset_loop_analyses%rowtype;
  existing_export exports%rowtype;
  next_version integer;
  created_export_id uuid := uuid_generate_v4();
  created_job_id uuid := uuid_generate_v4();
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'export idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('resolume-export:' || current_user_id::text || ':' || p_idempotency_key, 0)
  );
  select delivery.* into existing_export
  from exports as delivery
  where delivery.project_id = p_project_id
    and delivery.idempotency_key = p_idempotency_key;
  if found then
    return query select existing_export.id, existing_export.job_id, existing_export.status, existing_export.created_at;
    return;
  end if;

  select clip.* into target_clip
  from clips as clip
  join projects as project on project.id = clip.project_id
  where clip.id = p_clip_id
    and clip.project_id = p_project_id
    and project.user_id = current_user_id
  for update of clip;
  if not found then
    raise exception 'clip not found for authenticated project owner' using errcode = 'P0002';
  end if;
  if target_clip.status <> 'approved' or target_clip.current_asset_id is null then
    raise exception 'Resolume export requires a human-approved clip with a current immutable asset';
  end if;

  select asset.* into target_asset
  from project_assets as asset
  where asset.id = target_clip.current_asset_id
    and asset.project_id = p_project_id
    and asset.role = 'generated_output'
    and asset.status = 'ready';
  if not found then
    raise exception 'approved clip current asset is not a ready generated output';
  end if;

  select analysis.* into target_analysis
  from asset_loop_analyses as analysis
  where analysis.asset_id = target_asset.id
  order by analysis.created_at desc, analysis.id desc
  limit 1;
  if not found
    or target_analysis.algorithm_version <> 'boundary-seam-window-gray-v3'
    or target_analysis.decision <> 'pass' then
    raise exception 'Resolume export requires current passing seam-window evidence';
  end if;

  select coalesce(max(delivery.version), 0) + 1 into next_version
  from exports as delivery
  where delivery.project_id = p_project_id;

  insert into generation_jobs (
    id, project_id, workflow_id, orchestration_mode, stage, operation,
    idempotency_key, status, progress, input, source_asset_id, source_analysis_id
  ) values (
    created_job_id, p_project_id, created_job_id, 'solo', 'export_pack', 'export',
    'resolume-export:' || p_idempotency_key, 'queued', 0,
    jsonb_build_object(
      'exportId', created_export_id,
      'clipId', p_clip_id,
      'preset', 'resolume',
      'requestedBy', current_user_id
    ),
    target_asset.id, target_analysis.id
  );

  insert into exports (
    id, project_id, job_id, version, preset, status, clip_id,
    source_asset_id, source_analysis_id, idempotency_key
  ) values (
    created_export_id, p_project_id, created_job_id, next_version, 'resolume', 'queued', p_clip_id,
    target_asset.id, target_analysis.id, p_idempotency_key
  );

  return query select created_export_id, created_job_id, 'queued'::text, now();
end;
$$;

create or replace function complete_resolume_export(
  p_export_id uuid,
  p_job_id uuid,
  p_owner_id uuid,
  p_package_storage_path text,
  p_media_storage_path text,
  p_manifest_storage_path text,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  target_export exports%rowtype;
  target_job generation_jobs%rowtype;
  expected_prefix text;
begin
  select delivery.* into target_export
  from exports as delivery
  where delivery.id = p_export_id
  for update;
  if not found or target_export.job_id <> p_job_id or target_export.status <> 'exporting' then
    raise exception 'Resolume export is not ready for completion';
  end if;
  select job.* into target_job from generation_jobs as job where job.id = p_job_id for update;
  if not found or target_job.operation <> 'export' or target_job.status <> 'exporting' then
    raise exception 'matching export job is not in exporting state';
  end if;
  if not exists (select 1 from projects where id = target_export.project_id and user_id = p_owner_id) then
    raise exception 'project owner does not match Resolume export' using errcode = '42501';
  end if;
  if target_export.source_asset_id <> target_job.source_asset_id
    or target_export.source_analysis_id <> target_job.source_analysis_id then
    raise exception 'export source lineage changed before completion';
  end if;
  expected_prefix := p_owner_id::text || '/' || target_export.project_id::text || '/exports/' || p_export_id::text || '/';
  if p_package_storage_path <> expected_prefix
    or position(expected_prefix in p_media_storage_path) <> 1
    or position(expected_prefix in p_manifest_storage_path) <> 1
    or right(p_media_storage_path, 4) <> '.mov'
    or right(p_manifest_storage_path, 14) <> '/manifest.json' then
    raise exception 'Resolume delivery paths must use the immutable export prefix';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'project-assets' and name = p_media_storage_path)
    or not exists (select 1 from storage.objects where bucket_id = 'project-assets' and name = p_manifest_storage_path) then
    raise exception 'Resolume delivery objects were not uploaded';
  end if;
  if jsonb_typeof(p_manifest) <> 'object'
    or p_manifest ->> 'schemaVersion' <> 'resolume-delivery-v1'
    or p_manifest ->> 'exportId' <> p_export_id::text
    or p_manifest ->> 'projectId' <> target_export.project_id::text
    or p_manifest ->> 'jobId' <> p_job_id::text
    or p_manifest ->> 'preset' <> 'resolume'
    or p_manifest ->> 'deliveryState' <> 'ready_for_manual_resolume_import'
    or p_manifest #>> '{source,assetId}' <> target_export.source_asset_id::text
    or p_manifest #>> '{source,sourceAnalysisId}' <> target_export.source_analysis_id::text
    or p_manifest #>> '{media,storagePath}' <> p_media_storage_path
    or p_manifest #>> '{media,codec}' <> 'prores'
    or p_manifest #>> '{loopEvidence,algorithmVersion}' <> 'boundary-seam-window-gray-v3'
    or p_manifest #>> '{loopEvidence,decision}' <> 'pass' then
    raise exception 'Resolume delivery manifest does not match exact export lineage';
  end if;

  update exports
  set status = 'completed',
      storage_bucket = 'project-assets',
      storage_path = p_package_storage_path,
      manifest = p_manifest
  where id = p_export_id;
  update generation_jobs
  set status = 'completed', progress = 100, completed_at = now(), error_category = null, error_message = null
  where id = p_job_id;
  update projects set status = 'exported' where id = target_export.project_id;
end;
$$;

create or replace function claim_generation_job(worker_id text, lease_seconds integer default 60)
returns setof generation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if worker_id is null or length(trim(worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;
  if lease_seconds < 10 or lease_seconds > 3600 then
    raise exception 'lease_seconds must be between 10 and 3600';
  end if;
  return query
  with candidate as (
    select candidate_job.id
    from generation_jobs candidate_job
    where candidate_job.operation in ('generate', 'repair', 'export')
      and candidate_job.status in (
        'queued', 'submitting', 'provider_running', 'downloading', 'validating', 'repairing', 'exporting'
      )
      and (candidate_job.lease_expires_at is null or candidate_job.lease_expires_at < now())
      and not exists (
        select 1
        from job_dependencies dependency
        join generation_jobs predecessor on predecessor.id = dependency.depends_on_job_id
        where dependency.job_id = candidate_job.id and predecessor.status <> 'completed'
      )
    order by candidate_job.created_at
    for update of candidate_job skip locked
    limit 1
  )
  update generation_jobs as job
  set leased_by = worker_id,
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

create or replace function sync_export_status_from_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.operation = 'export' and new.status is distinct from old.status then
    update exports
    set status = new.status
    where job_id = new.id
      and project_id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists generation_jobs_sync_export_status on generation_jobs;
create trigger generation_jobs_sync_export_status
after update of status on generation_jobs
for each row execute function sync_export_status_from_job();

revoke all on function request_resolume_export(uuid, uuid, text) from public;
revoke all on function complete_resolume_export(uuid, uuid, uuid, text, text, text, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function request_resolume_export(uuid, uuid, text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function complete_resolume_export(uuid, uuid, uuid, text, text, text, jsonb) to service_role;
    grant execute on function claim_generation_job(text, integer) to service_role;
  end if;
end $$;
