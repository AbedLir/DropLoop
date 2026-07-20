create table if not exists asset_loop_analyses (
  id uuid primary key,
  job_id uuid not null references generation_jobs(id) on delete cascade,
  asset_id uuid not null references project_assets(id) on delete cascade,
  algorithm_version text not null,
  decision text not null,
  loop_score integer not null,
  boundary_mae_percent double precision not null,
  first_frame_luma_percent double precision not null,
  last_frame_luma_percent double precision not null,
  brightness_jump_percent double precision not null,
  first_frame_black boolean not null,
  last_frame_black boolean not null,
  reasons text[] not null default '{}',
  policy jsonb not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  unique (job_id, asset_id, algorithm_version),
  check (decision in ('pass', 'repair_required')),
  check (loop_score between 0 and 100),
  check (boundary_mae_percent between 0 and 100),
  check (first_frame_luma_percent between 0 and 100),
  check (last_frame_luma_percent between 0 and 100),
  check (brightness_jump_percent between 0 and 100),
  check (jsonb_typeof(policy) = 'object'),
  check (jsonb_typeof(evidence) = 'object')
);

alter table asset_loop_analyses enable row level security;

drop policy if exists asset_loop_analyses_select_own on asset_loop_analyses;
create policy asset_loop_analyses_select_own on asset_loop_analyses
  for select using (
    exists (
      select 1
      from projects as owned_project
      join project_assets as owned_asset on owned_asset.project_id = owned_project.id
      where owned_asset.id = asset_loop_analyses.asset_id
        and owned_project.user_id = auth.uid()
    )
  );

create or replace function register_asset_loop_analysis(
  p_analysis_id uuid,
  p_job_id uuid,
  p_asset_id uuid,
  p_evidence jsonb
)
returns table (
  analysis_id uuid,
  job_id uuid,
  asset_id uuid,
  evidence jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job generation_jobs%rowtype;
  target_asset project_assets%rowtype;
  existing_analysis asset_loop_analyses%rowtype;
  stored_analysis asset_loop_analyses%rowtype;
  evidence_reasons text[];
  evidence_decision text;
begin
  if jsonb_typeof(p_evidence) <> 'object' or jsonb_typeof(p_evidence -> 'policy') <> 'object'
    or jsonb_typeof(p_evidence -> 'reasons') <> 'array' then
    raise exception 'loop analysis evidence must contain policy and reasons';
  end if;

  select candidate_job.* into target_job
  from generation_jobs as candidate_job
  where candidate_job.id = p_job_id
  for update;
  if not found then
    raise exception 'generation job not found' using errcode = 'P0002';
  end if;
  if target_job.status <> 'validating' or target_job.output_asset_id <> p_asset_id then
    raise exception 'job must be validating its immutable output asset';
  end if;

  select candidate_asset.* into target_asset
  from project_assets as candidate_asset
  where candidate_asset.id = p_asset_id
    and candidate_asset.source_job_id = p_job_id
    and candidate_asset.project_id = target_job.project_id
    and candidate_asset.role = 'generated_output';
  if not found then
    raise exception 'generated output asset does not belong to job' using errcode = '42501';
  end if;

  evidence_decision := p_evidence ->> 'decision';
  if nullif(trim(p_evidence ->> 'algorithmVersion'), '') is null
    or p_evidence -> 'policy' ->> 'algorithmVersion' <> p_evidence ->> 'algorithmVersion'
    or evidence_decision not in ('pass', 'repair_required')
    or jsonb_typeof(p_evidence -> 'firstFrameBlack') <> 'boolean'
    or jsonb_typeof(p_evidence -> 'lastFrameBlack') <> 'boolean' then
    raise exception 'loop analysis evidence is invalid';
  end if;

  evidence_reasons := array(select jsonb_array_elements_text(p_evidence -> 'reasons'));
  perform pg_advisory_xact_lock(hashtextextended('loop-analysis:' || p_job_id::text || ':' || p_asset_id::text, 0));

  select candidate_analysis.* into existing_analysis
  from asset_loop_analyses as candidate_analysis
  where candidate_analysis.job_id = p_job_id
    and candidate_analysis.asset_id = p_asset_id
    and candidate_analysis.algorithm_version = p_evidence ->> 'algorithmVersion';
  if found then
    if existing_analysis.id <> p_analysis_id or existing_analysis.evidence <> p_evidence then
      raise exception 'loop analysis version already owns different evidence';
    end if;
    stored_analysis := existing_analysis;
  else
    insert into asset_loop_analyses (
      id, job_id, asset_id, algorithm_version, decision, loop_score,
      boundary_mae_percent, first_frame_luma_percent, last_frame_luma_percent,
      brightness_jump_percent, first_frame_black, last_frame_black, reasons, policy, evidence
    ) values (
      p_analysis_id, p_job_id, p_asset_id, p_evidence ->> 'algorithmVersion', evidence_decision,
      (p_evidence ->> 'loopScore')::integer,
      (p_evidence ->> 'boundaryMaePercent')::double precision,
      (p_evidence ->> 'firstFrameLumaPercent')::double precision,
      (p_evidence ->> 'lastFrameLumaPercent')::double precision,
      (p_evidence ->> 'brightnessJumpPercent')::double precision,
      (p_evidence ->> 'firstFrameBlack')::boolean,
      (p_evidence ->> 'lastFrameBlack')::boolean,
      evidence_reasons, p_evidence -> 'policy', p_evidence
    ) returning * into stored_analysis;
  end if;

  if target_asset.planned_clip_id is not null then
    update clips as target_clip
    set loop_score = stored_analysis.loop_score,
        review_recommended_action = case when stored_analysis.decision = 'pass' then 'approve' else 'repair' end,
        review_reason = case
          when stored_analysis.decision = 'pass' then
            'Decoded boundary analysis passed: MAE ' || stored_analysis.boundary_mae_percent::text ||
            '%, brightness jump ' || stored_analysis.brightness_jump_percent::text || '%.'
          else array_to_string(stored_analysis.reasons, ' ')
        end
    where target_clip.project_id = target_job.project_id
      and target_clip.planned_clip_id = target_asset.planned_clip_id;
  end if;

  return query select
    stored_analysis.id,
    stored_analysis.job_id,
    stored_analysis.asset_id,
    stored_analysis.evidence,
    stored_analysis.created_at;
end;
$$;

revoke all on function register_asset_loop_analysis(uuid, uuid, uuid, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on asset_loop_analyses to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function register_asset_loop_analysis(uuid, uuid, uuid, jsonb) to service_role;
  end if;
end $$;
