alter table project_assets
  add column if not exists parent_asset_id uuid references project_assets(id) on delete set null;

alter table clips
  add column if not exists current_asset_id uuid references project_assets(id) on delete set null;

alter table generation_jobs
  add column if not exists source_asset_id uuid references project_assets(id) on delete set null,
  add column if not exists source_analysis_id uuid references asset_loop_analyses(id) on delete set null;

alter table asset_loop_analyses
  add column if not exists source_analysis_id uuid references asset_loop_analyses(id) on delete set null;

create index if not exists project_assets_parent_asset
  on project_assets (parent_asset_id);

create index if not exists generation_jobs_repair_source
  on generation_jobs (source_asset_id, source_analysis_id)
  where operation = 'repair';

create index if not exists asset_loop_analyses_source_analysis
  on asset_loop_analyses (source_analysis_id)
  where source_analysis_id is not null;

with ranked_assets as (
  select
    candidate_asset.id,
    candidate_asset.project_id,
    candidate_asset.planned_clip_id,
    row_number() over (
      partition by candidate_asset.project_id, candidate_asset.planned_clip_id
      order by candidate_asset.version desc, candidate_asset.created_at desc, candidate_asset.id desc
    ) as position
  from project_assets as candidate_asset
  where candidate_asset.role = 'generated_output'
    and candidate_asset.planned_clip_id is not null
)
update clips as target_clip
set current_asset_id = ranked_asset.id
from ranked_assets as ranked_asset
where ranked_asset.position = 1
  and ranked_asset.project_id = target_clip.project_id
  and ranked_asset.planned_clip_id = target_clip.planned_clip_id
  and target_clip.current_asset_id is null;

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
  if new.operation <> 'repair' then
    if new.source_asset_id is not null or new.source_analysis_id is not null then
      raise exception 'only repair jobs may bind source asset lineage';
    end if;
    return new;
  end if;

  requested_clip_id := nullif(new.input ->> 'clipId', '')::uuid;
  requested_asset_id := coalesce(new.source_asset_id, nullif(new.input ->> 'sourceAssetId', '')::uuid);
  requested_analysis_id := coalesce(new.source_analysis_id, nullif(new.input ->> 'sourceAnalysisId', '')::uuid);

  if requested_clip_id is not null then
    select candidate_clip.* into target_clip
    from clips as candidate_clip
    where candidate_clip.id = requested_clip_id
      and candidate_clip.project_id = new.project_id;
    if not found then
      raise exception 'repair clip does not belong to job project' using errcode = '42501';
    end if;
    requested_asset_id := coalesce(requested_asset_id, target_clip.current_asset_id);
    if target_clip.current_asset_id is null or requested_asset_id <> target_clip.current_asset_id then
      raise exception 'repair job must bind the clip current immutable asset';
    end if;
  end if;

  if requested_asset_id is null then
    raise exception 'repair job requires an immutable source asset';
  end if;
  select candidate_asset.* into target_asset
  from project_assets as candidate_asset
  where candidate_asset.id = requested_asset_id
    and candidate_asset.project_id = new.project_id
    and candidate_asset.role = 'generated_output'
    and candidate_asset.status = 'ready';
  if not found then
    raise exception 'repair source must be a ready generated output in the job project' using errcode = '42501';
  end if;

  if requested_analysis_id is null then
    select candidate_analysis.id into requested_analysis_id
    from asset_loop_analyses as candidate_analysis
    where candidate_analysis.asset_id = requested_asset_id
    order by candidate_analysis.created_at desc, candidate_analysis.id desc
    limit 1;
  end if;
  if requested_analysis_id is null then
    raise exception 'repair job requires persisted source loop evidence';
  end if;
  select candidate_analysis.* into target_analysis
  from asset_loop_analyses as candidate_analysis
  where candidate_analysis.id = requested_analysis_id
    and candidate_analysis.asset_id = requested_asset_id;
  if not found then
    raise exception 'repair source analysis does not belong to source asset' using errcode = '42501';
  end if;
  if exists (
    select 1
    from asset_loop_analyses as newer_analysis
    where newer_analysis.asset_id = requested_asset_id
      and (newer_analysis.created_at, newer_analysis.id) > (target_analysis.created_at, target_analysis.id)
  ) then
    raise exception 'repair job must bind the latest source loop evidence';
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

drop trigger if exists generation_jobs_bind_repair_source on generation_jobs;
create trigger generation_jobs_bind_repair_source
before insert on generation_jobs
for each row execute function bind_repair_job_source();

create or replace function prepare_provider_output_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_job generation_jobs%rowtype;
  source_asset project_assets%rowtype;
  source_analysis asset_loop_analyses%rowtype;
  next_version integer;
begin
  if new.role <> 'generated_output' or new.source_job_id is null then
    return new;
  end if;
  select candidate_job.* into source_job
  from generation_jobs as candidate_job
  where candidate_job.id = new.source_job_id;
  if not found or source_job.project_id <> new.project_id then
    raise exception 'provider output job does not belong to asset project' using errcode = '42501';
  end if;

  if source_job.operation = 'repair' then
    if source_job.source_asset_id is null or source_job.source_analysis_id is null then
      raise exception 'repair output job is missing immutable source lineage';
    end if;
    select candidate_asset.* into source_asset
    from project_assets as candidate_asset
    where candidate_asset.id = source_job.source_asset_id
      and candidate_asset.project_id = new.project_id
      and candidate_asset.role = 'generated_output';
    select candidate_analysis.* into source_analysis
    from asset_loop_analyses as candidate_analysis
    where candidate_analysis.id = source_job.source_analysis_id
      and candidate_analysis.asset_id = source_job.source_asset_id;
    if source_asset.id is null or source_analysis.id is null then
      raise exception 'repair output source lineage is invalid' using errcode = '42501';
    end if;
    new.planned_clip_id := coalesce(new.planned_clip_id, source_asset.planned_clip_id);
    if new.planned_clip_id is distinct from source_asset.planned_clip_id then
      raise exception 'repair output must preserve planned clip identity';
    end if;
    new.parent_asset_id := source_asset.id;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'repairSourceAssetId', source_asset.id,
      'repairSourceAnalysisId', source_analysis.id
    );
  elsif new.parent_asset_id is not null then
    raise exception 'non-repair provider output cannot claim repair lineage';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('asset-version:' || new.project_id::text || ':' || coalesce(new.planned_clip_id, new.id::text), 0)
  );
  select coalesce(max(existing_asset.version), 0) + 1 into next_version
  from project_assets as existing_asset
  where existing_asset.project_id = new.project_id
    and existing_asset.role = 'generated_output'
    and existing_asset.planned_clip_id is not distinct from new.planned_clip_id;
  new.version := next_version;
  return new;
end;
$$;

drop trigger if exists project_assets_prepare_output_lineage on project_assets;
create trigger project_assets_prepare_output_lineage
before insert on project_assets
for each row execute function prepare_provider_output_lineage();

create or replace function select_current_provider_output()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'generated_output' and new.planned_clip_id is not null then
    update clips as target_clip
    set current_asset_id = new.id
    where target_clip.project_id = new.project_id
      and target_clip.planned_clip_id = new.planned_clip_id;
  end if;
  return new;
end;
$$;

drop trigger if exists project_assets_select_current_output on project_assets;
create trigger project_assets_select_current_output
after insert on project_assets
for each row execute function select_current_provider_output();

create or replace function bind_repair_analysis_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_job generation_jobs%rowtype;
  target_asset project_assets%rowtype;
begin
  select candidate_job.* into target_job
  from generation_jobs as candidate_job
  where candidate_job.id = new.job_id;
  if not found then
    raise exception 'loop analysis job does not exist' using errcode = 'P0002';
  end if;
  if target_job.operation = 'repair' then
    select candidate_asset.* into target_asset
    from project_assets as candidate_asset
    where candidate_asset.id = new.asset_id;
    if target_job.source_analysis_id is null
      or target_asset.parent_asset_id is distinct from target_job.source_asset_id then
      raise exception 'repair analysis must follow the job exact source asset and evidence';
    end if;
    new.source_analysis_id := target_job.source_analysis_id;
  elsif new.source_analysis_id is not null then
    raise exception 'non-repair analysis cannot claim before evidence';
  end if;
  return new;
end;
$$;

drop trigger if exists asset_loop_analyses_bind_repair_source on asset_loop_analyses;
create trigger asset_loop_analyses_bind_repair_source
before insert on asset_loop_analyses
for each row execute function bind_repair_analysis_source();
