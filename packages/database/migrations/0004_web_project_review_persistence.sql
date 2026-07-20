alter table projects
  add column if not exists creation_key text,
  add column if not exists pipeline_snapshot jsonb not null default '{}'::jsonb;

insert into users_profile (id, email, display_name)
select
  auth_user.id,
  auth_user.email,
  coalesce(auth_user.raw_user_meta_data ->> 'display_name', auth_user.raw_user_meta_data ->> 'name')
from auth.users auth_user
on conflict (id) do nothing;

update projects
set creation_key = 'legacy:' || id::text
where creation_key is null;

alter table projects
  alter column creation_key set not null;

create unique index if not exists projects_user_creation_key
  on projects (user_id, creation_key);

alter table clips
  add column if not exists duration_seconds integer,
  add column if not exists review_recommended_action text,
  add column if not exists review_reason text;

create unique index if not exists clips_project_planned_clip
  on clips (project_id, planned_clip_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clips_duration_seconds_check') then
    alter table clips
      add constraint clips_duration_seconds_check
      check (duration_seconds is null or duration_seconds > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clips_review_recommended_action_check') then
    alter table clips
      add constraint clips_review_recommended_action_check
      check (
        review_recommended_action is null
        or review_recommended_action in ('approve', 'reject', 'repair', 'regenerate')
      );
  end if;
end $$;

alter table review_actions
  add column if not exists idempotency_key text;

update review_actions
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

alter table review_actions
  alter column idempotency_key set not null;

create unique index if not exists review_actions_user_idempotency_key
  on review_actions (user_id, idempotency_key);

create or replace function create_project_with_clips(
  p_project_id uuid,
  p_creation_key text,
  p_name text,
  p_template text,
  p_music_genre text,
  p_bpm integer,
  p_screen_format text,
  p_pack_size integer,
  p_desired_mood text,
  p_show_type text,
  p_pipeline_snapshot jsonb,
  p_clips jsonb
)
returns setof projects
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_project projects%rowtype;
  created_project projects%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'project id is required';
  end if;

  if p_creation_key is null or length(trim(p_creation_key)) = 0 then
    raise exception 'creation key is required';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'project name is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('project:' || current_user_id::text || ':' || p_creation_key, 0)
  );

  if jsonb_typeof(coalesce(p_clips, '[]'::jsonb)) <> 'array' then
    raise exception 'clips must be a JSON array';
  end if;

  select project.*
    into existing_project
  from projects project
  where project.user_id = current_user_id
    and project.creation_key = p_creation_key;

  if found then
    if existing_project.id <> p_project_id
      or existing_project.name <> p_name
      or existing_project.template <> p_template
      or existing_project.screen_format <> p_screen_format
      or existing_project.pack_size <> p_pack_size then
      raise exception 'creation key already belongs to a different project payload';
    end if;

    return next existing_project;
    return;
  end if;

  insert into projects (
    id,
    user_id,
    creation_key,
    name,
    status,
    template,
    music_genre,
    bpm,
    screen_format,
    pack_size,
    desired_mood,
    show_type,
    pipeline_snapshot
  )
  values (
    p_project_id,
    current_user_id,
    p_creation_key,
    trim(p_name),
    'reviewing',
    p_template,
    p_music_genre,
    p_bpm,
    p_screen_format,
    p_pack_size,
    p_desired_mood,
    p_show_type,
    coalesce(p_pipeline_snapshot, '{}'::jsonb)
  )
  returning * into created_project;

  insert into clips (
    project_id,
    planned_clip_id,
    role,
    energy,
    status,
    preview_url,
    thumbnail_url,
    duration_seconds,
    loop_score,
    quality_score,
    review_recommended_action,
    review_reason
  )
  select
    created_project.id,
    clip.planned_clip_id,
    clip.role,
    clip.energy,
    clip.status,
    clip.preview_url,
    clip.thumbnail_url,
    clip.duration_seconds,
    clip.loop_score,
    clip.quality_score,
    clip.review_recommended_action,
    clip.review_reason
  from jsonb_to_recordset(coalesce(p_clips, '[]'::jsonb)) as clip(
    planned_clip_id text,
    role text,
    energy integer,
    status text,
    preview_url text,
    thumbnail_url text,
    duration_seconds integer,
    loop_score integer,
    quality_score integer,
    review_recommended_action text,
    review_reason text
  );

  return next created_project;
end;
$$;

revoke all on function create_project_with_clips(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  integer,
  text,
  text,
  jsonb,
  jsonb
) from public;

grant execute on function create_project_with_clips(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  integer,
  text,
  text,
  jsonb,
  jsonb
) to authenticated;

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
      and job.status not in ('completed', 'failed', 'cancelled')
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

drop policy if exists review_actions_insert_own on review_actions;
revoke insert on review_actions from authenticated;

revoke all on function apply_clip_review_action(uuid, uuid, text, text, text) from public;
grant execute on function apply_clip_review_action(uuid, uuid, text, text, text) to authenticated;
