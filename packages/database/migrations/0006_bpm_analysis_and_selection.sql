alter table project_assets
  add column if not exists bpm_analyzed numeric(7, 3),
  add column if not exists bpm_confidence numeric(5, 4),
  add column if not exists bpm_analysis_version text,
  add column if not exists beat_grid_assumption text;

alter table projects
  add column if not exists bpm_analyzed numeric(7, 3),
  add column if not exists bpm_confidence numeric(5, 4),
  add column if not exists bpm_source text not null default 'manual_override',
  add column if not exists bpm_analyzed_asset_id uuid references project_assets(id) on delete set null,
  add column if not exists beat_grid_assumption jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_assets_bpm_analysis_check') then
    alter table project_assets
      add constraint project_assets_bpm_analysis_check
      check (
        (bpm_analyzed is null or bpm_analyzed between 40 and 240)
        and (bpm_confidence is null or bpm_confidence between 0 and 1)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'projects_bpm_analysis_check') then
    alter table projects
      add constraint projects_bpm_analysis_check
      check (
        (bpm_analyzed is null or bpm_analyzed between 40 and 240)
        and (bpm_confidence is null or bpm_confidence between 0 and 1)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'projects_bpm_source_check') then
    alter table projects
      add constraint projects_bpm_source_check
      check (bpm_source in ('analysis', 'manual_override'));
  end if;
end $$;

create or replace function populate_project_asset_bpm_analysis()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  analysis jsonb := new.metadata -> 'bpmAnalysis';
begin
  if new.type <> 'audio' or jsonb_typeof(analysis) <> 'object' then
    return new;
  end if;

  new.bpm_analyzed := nullif(analysis ->> 'analyzedBpm', '')::numeric;
  new.bpm_confidence := coalesce(nullif(analysis ->> 'confidence', '')::numeric, 0);
  new.bpm_analysis_version := nullif(analysis ->> 'algorithmVersion', '');
  new.beat_grid_assumption := nullif(analysis ->> 'beatGridAssumption', '');
  return new;
end;
$$;

drop trigger if exists project_assets_populate_bpm_analysis on project_assets;
create trigger project_assets_populate_bpm_analysis
before insert on project_assets
for each row execute function populate_project_asset_bpm_analysis();

create or replace function sync_project_bpm_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> 'source_audio' then
    return new;
  end if;

  update projects
  set bpm_analyzed = new.bpm_analyzed,
      bpm_confidence = new.bpm_confidence,
      bpm_analyzed_asset_id = new.id,
      beat_grid_assumption = jsonb_build_object(
        'selectedBpm', bpm,
        'selectedSource', bpm_source,
        'analyzedBpm', new.bpm_analyzed,
        'confidence', new.bpm_confidence,
        'analysisVersion', new.bpm_analysis_version,
        'assumption', new.beat_grid_assumption
      ),
      updated_at = now()
  where id = new.project_id;

  return new;
end;
$$;

drop trigger if exists project_assets_sync_project_bpm on project_assets;
create trigger project_assets_sync_project_bpm
after insert on project_assets
for each row execute function sync_project_bpm_analysis();

create or replace function set_project_bpm_selection(
  p_project_id uuid,
  p_selected_bpm integer,
  p_source text,
  p_analysis_asset_id uuid default null
)
returns setof projects
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  analysis_asset project_assets%rowtype;
  updated_project projects%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_selected_bpm < 40 or p_selected_bpm > 240 then
    raise exception 'selected BPM must be between 40 and 240';
  end if;

  if p_source not in ('analysis', 'manual_override') then
    raise exception 'invalid BPM selection source';
  end if;

  if not exists (
    select 1 from projects
    where id = p_project_id and user_id = current_user_id
  ) then
    raise exception 'project not found for authenticated owner' using errcode = 'P0002';
  end if;

  if p_analysis_asset_id is not null then
    select asset.* into analysis_asset
    from project_assets asset
    where asset.id = p_analysis_asset_id
      and asset.project_id = p_project_id
      and asset.role = 'source_audio';

    if not found then
      raise exception 'source audio analysis asset not found';
    end if;
  end if;

  if p_source = 'analysis' then
    if p_analysis_asset_id is null or analysis_asset.bpm_analyzed is null then
      raise exception 'analyzed BPM is unavailable';
    end if;
    if p_selected_bpm <> round(analysis_asset.bpm_analyzed)::integer then
      raise exception 'analysis selection must use the rounded analyzed BPM';
    end if;
  end if;

  update projects
  set bpm = p_selected_bpm,
      bpm_source = p_source,
      bpm_analyzed = coalesce(analysis_asset.bpm_analyzed, bpm_analyzed),
      bpm_confidence = coalesce(analysis_asset.bpm_confidence, bpm_confidence),
      bpm_analyzed_asset_id = coalesce(p_analysis_asset_id, bpm_analyzed_asset_id),
      beat_grid_assumption = jsonb_build_object(
        'selectedBpm', p_selected_bpm,
        'selectedSource', p_source,
        'analyzedBpm', coalesce(analysis_asset.bpm_analyzed, bpm_analyzed),
        'confidence', coalesce(analysis_asset.bpm_confidence, bpm_confidence),
        'analysisAssetId', coalesce(p_analysis_asset_id, bpm_analyzed_asset_id),
        'assumption', coalesce(analysis_asset.beat_grid_assumption, beat_grid_assumption ->> 'assumption')
      ),
      updated_at = now()
  where id = p_project_id
  returning * into updated_project;

  return next updated_project;
end;
$$;

revoke all on function set_project_bpm_selection(uuid, integer, text, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function set_project_bpm_selection(uuid, integer, text, uuid) to authenticated;
  end if;
end $$;
