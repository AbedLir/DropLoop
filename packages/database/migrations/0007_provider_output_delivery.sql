alter table job_attempts
  add column if not exists provider_result jsonb,
  add column if not exists latency_ms bigint;

alter table generation_jobs
  add column if not exists output_asset_id uuid references project_assets(id) on delete set null,
  add column if not exists provider_latency_ms bigint,
  add column if not exists download_latency_ms bigint;

alter table project_assets
  add column if not exists source_job_id uuid references generation_jobs(id) on delete set null,
  add column if not exists source_attempt_id uuid references job_attempts(id) on delete set null,
  add column if not exists planned_clip_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_attempts_latency_check') then
    alter table job_attempts add constraint job_attempts_latency_check check (latency_ms is null or latency_ms >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_attempts_provider_result_check') then
    alter table job_attempts add constraint job_attempts_provider_result_check check (
      provider_result is null
      or (
        jsonb_typeof(provider_result) = 'object'
        and jsonb_typeof(provider_result -> 'previewUrl') = 'string'
        and length(trim(provider_result ->> 'previewUrl')) > 0
      )
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_provider_latency_check') then
    alter table generation_jobs add constraint generation_jobs_provider_latency_check
      check (provider_latency_ms is null or provider_latency_ms >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_download_latency_check') then
    alter table generation_jobs add constraint generation_jobs_download_latency_check
      check (download_latency_ms is null or download_latency_ms >= 0);
  end if;
end $$;

drop index if exists project_assets_project_content_sha256;
create unique index if not exists project_assets_source_content_sha256
  on project_assets (project_id, content_sha256)
  where content_sha256 is not null and role in ('source_audio', 'mood_reference');

create unique index if not exists project_assets_provider_attempt
  on project_assets (source_attempt_id)
  where source_attempt_id is not null;

alter table project_assets drop constraint if exists project_assets_role_type_check;
alter table project_assets add constraint project_assets_role_type_check check (
  (role = 'source_audio' and type = 'audio')
  or (role = 'mood_reference' and type in ('image', 'video'))
  or (role in ('generated_output', 'playable_preview') and type = 'video')
);

alter table project_assets drop constraint if exists project_assets_size_check;
alter table project_assets add constraint project_assets_size_check check (
  size_bytes > 0
  and (
    (role in ('source_audio', 'mood_reference') and size_bytes <= 67108864)
    or (role in ('generated_output', 'playable_preview') and size_bytes <= 268435456)
  )
);

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
    where candidate_job.operation in ('generate', 'repair')
      and candidate_job.status in (
        'queued', 'submitting', 'provider_running', 'downloading', 'validating', 'repairing'
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

revoke all on function claim_generation_job(text, integer) from public;

create or replace function register_provider_output(
  p_asset_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_owner_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_download_latency_ms bigint,
  p_duration_seconds double precision,
  p_width integer,
  p_height integer,
  p_frame_rate double precision,
  p_codec text,
  p_pixel_format text,
  p_has_alpha boolean
)
returns table (
  asset_id uuid,
  project_id uuid,
  job_id uuid,
  attempt_id uuid,
  storage_bucket text,
  storage_path text,
  preview_url text
)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  target_job generation_jobs%rowtype;
  target_attempt job_attempts%rowtype;
  existing_asset project_assets%rowtype;
  expected_prefix text;
  target_clip_id text;
begin
  select * into target_job from generation_jobs where id = p_job_id for update;
  if not found then
    raise exception 'generation job not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from projects where id = target_job.project_id and user_id = p_owner_id) then
    raise exception 'project owner does not match generation job' using errcode = '42501';
  end if;

  select * into target_attempt from job_attempts where id = p_attempt_id and job_id = p_job_id;
  if not found or target_attempt.status <> 'completed'
    or jsonb_typeof(target_attempt.provider_result) <> 'object'
    or nullif(trim(target_attempt.provider_result ->> 'previewUrl'), '') is null then
    raise exception 'completed provider attempt with result is required';
  end if;

  if p_storage_bucket <> 'project-assets' then
    raise exception 'provider output must use the private project-assets bucket';
  end if;
  expected_prefix := p_owner_id::text || '/' || target_job.project_id::text || '/outputs/' ||
    p_job_id::text || '/' || p_attempt_id::text || '/';
  if p_storage_path is null or position(expected_prefix in p_storage_path) <> 1 then
    raise exception 'storage path must use the immutable provider output prefix' using errcode = '42501';
  end if;
  if p_filename is null or length(trim(p_filename)) = 0 or p_filename like '%/%'
    or right(p_storage_path, length(p_filename)) <> p_filename then
    raise exception 'safe output filename must match the storage object';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'valid sha256 digest is required';
  end if;
  if p_download_latency_ms is null or p_download_latency_ms < 0 then
    raise exception 'non-negative download latency is required';
  end if;
  if p_mime_type not in ('video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'supported video mime type is required';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = p_storage_bucket and name = p_storage_path
  ) then
    raise exception 'uploaded provider output object not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('provider-output:' || p_attempt_id::text, 0));
  select * into existing_asset from project_assets where source_attempt_id = p_attempt_id;
  if found then
    if existing_asset.id <> p_asset_id or existing_asset.storage_path <> p_storage_path
      or existing_asset.content_sha256 <> p_content_sha256 then
      raise exception 'provider attempt already owns a different immutable output';
    end if;
  else
    target_clip_id := coalesce(
      target_job.input #>> '{prompt,clipId}',
      target_job.input #>> '{clip,plannedClipId}',
      target_job.input #>> '{clip,id}'
    );
    insert into project_assets (
      id, project_id, type, role, url, filename, mime_type, size_bytes,
      storage_bucket, storage_path, status, version, content_sha256,
      duration_seconds, width, height, frame_rate, codec, pixel_format, has_alpha,
      source_job_id, source_attempt_id, planned_clip_id, metadata
    ) values (
      p_asset_id, target_job.project_id, 'video', 'generated_output',
      'storage://' || p_storage_bucket || '/' || p_storage_path,
      trim(p_filename), p_mime_type, p_size_bytes,
      p_storage_bucket, p_storage_path, 'ready', 1, p_content_sha256,
      p_duration_seconds, p_width, p_height, p_frame_rate, p_codec, p_pixel_format, p_has_alpha,
      p_job_id, p_attempt_id, target_clip_id,
      jsonb_build_object('provider', target_attempt.provider, 'providerModel', target_attempt.provider_model)
    ) returning * into existing_asset;
  end if;

  update generation_jobs
  set output_asset_id = existing_asset.id,
      download_latency_ms = p_download_latency_ms
  where id = p_job_id;
  if existing_asset.planned_clip_id is not null then
    update clips
    set preview_url = '/api/projects/' || target_job.project_id::text || '/assets/' || existing_asset.id::text || '/content',
        status = 'generated'
    where project_id = target_job.project_id and planned_clip_id = existing_asset.planned_clip_id;
  end if;

  return query select
    existing_asset.id,
    target_job.project_id,
    p_job_id,
    p_attempt_id,
    existing_asset.storage_bucket,
    existing_asset.storage_path,
    '/api/projects/' || target_job.project_id::text || '/assets/' || existing_asset.id::text || '/content';
end;
$$;

revoke all on function register_provider_output(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text, bigint,
  double precision, integer, integer, double precision, text, text, boolean
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_generation_job(text, integer) to service_role;
    grant execute on function register_provider_output(
      uuid, uuid, uuid, uuid, text, text, text, text, bigint, text, bigint,
      double precision, integer, integer, double precision, text, text, boolean
    ) to service_role;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = 268435456 where id = ''project-assets''';
  end if;
end $$;
