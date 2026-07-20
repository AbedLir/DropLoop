alter table generation_jobs
  add column if not exists workflow_id uuid,
  add column if not exists orchestration_mode text not null default 'solo';

update generation_jobs
set workflow_id = id
where workflow_id is null;

alter table generation_jobs
  alter column workflow_id set default uuid_generate_v4(),
  alter column workflow_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_orchestration_mode_check') then
    alter table generation_jobs
      add constraint generation_jobs_orchestration_mode_check
      check (orchestration_mode in ('solo', 'pipeline', 'split'));
  end if;
end $$;

create index if not exists generation_jobs_workflow
  on generation_jobs (project_id, workflow_id, created_at);

create table if not exists job_dependencies (
  job_id uuid not null references generation_jobs(id) on delete cascade,
  depends_on_job_id uuid not null references generation_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, depends_on_job_id),
  check (job_id <> depends_on_job_id)
);

create index if not exists job_dependencies_predecessor
  on job_dependencies (depends_on_job_id, job_id);

create table if not exists job_timeline_events (
  id uuid primary key default uuid_generate_v4(),
  sequence bigint generated always as identity unique,
  job_id uuid not null references generation_jobs(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id text,
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (event_type in (
    'job_reserved',
    'dependency_added',
    'status_changed',
    'progress_changed',
    'lease_claimed',
    'lease_released',
    'attempt_started',
    'attempt_updated'
  )),
  check (actor_type in ('system', 'worker', 'provider', 'user'))
);

create index if not exists job_timeline_events_job_sequence
  on job_timeline_events (job_id, sequence);

create or replace function validate_job_dependency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  child_project_id uuid;
  child_workflow_id uuid;
  child_mode text;
  parent_project_id uuid;
  parent_workflow_id uuid;
begin
  select project_id, workflow_id, orchestration_mode
    into child_project_id, child_workflow_id, child_mode
  from generation_jobs
  where id = new.job_id;

  select project_id, workflow_id
    into parent_project_id, parent_workflow_id
  from generation_jobs
  where id = new.depends_on_job_id;

  if child_project_id is null or parent_project_id is null then
    raise exception 'job dependency endpoints must exist';
  end if;

  if child_mode <> 'pipeline' then
    raise exception 'only pipeline jobs may declare dependencies';
  end if;

  if child_project_id <> parent_project_id then
    raise exception 'job dependencies cannot cross projects';
  end if;

  if child_workflow_id <> parent_workflow_id then
    raise exception 'job dependencies cannot cross workflows';
  end if;

  if exists (
    with recursive ancestors(job_id) as (
      select depends_on_job_id
      from job_dependencies
      where job_id = new.depends_on_job_id

      union

      select dependency.depends_on_job_id
      from job_dependencies dependency
      join ancestors on dependency.job_id = ancestors.job_id
    )
    select 1 from ancestors where job_id = new.job_id
  ) then
    raise exception 'job dependency would create a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists job_dependencies_validate on job_dependencies;
create trigger job_dependencies_validate
before insert or update on job_dependencies
for each row execute function validate_job_dependency();

create or replace function record_generation_job_timeline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into job_timeline_events (job_id, event_type, actor_type, to_status, payload)
    values (
      new.id,
      'job_reserved',
      'system',
      new.status,
      jsonb_build_object(
        'workflowId', new.workflow_id,
        'orchestrationMode', new.orchestration_mode,
        'operation', new.operation,
        'idempotencyKey', new.idempotency_key
      )
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into job_timeline_events (
      job_id,
      event_type,
      actor_type,
      actor_id,
      from_status,
      to_status,
      payload
    )
    values (
      new.id,
      'status_changed',
      case when new.leased_by is null then 'system' else 'worker' end,
      new.leased_by,
      old.status,
      new.status,
      jsonb_build_object(
        'progress', new.progress,
        'attemptCount', new.attempt_count,
        'errorCategory', new.error_category
      )
    );
  end if;

  if old.progress is distinct from new.progress and old.status is not distinct from new.status then
    insert into job_timeline_events (job_id, event_type, actor_type, actor_id, payload)
    values (
      new.id,
      'progress_changed',
      case when new.leased_by is null then 'system' else 'worker' end,
      new.leased_by,
      jsonb_build_object('from', old.progress, 'to', new.progress, 'status', new.status)
    );
  end if;

  if old.leased_by is distinct from new.leased_by then
    if new.leased_by is not null then
      insert into job_timeline_events (job_id, event_type, actor_type, actor_id, payload)
      values (
        new.id,
        'lease_claimed',
        'worker',
        new.leased_by,
        jsonb_build_object('expiresAt', new.lease_expires_at)
      );
    elsif old.leased_by is not null then
      insert into job_timeline_events (job_id, event_type, actor_type, actor_id, payload)
      values (
        new.id,
        'lease_released',
        'worker',
        old.leased_by,
        '{}'::jsonb
      );
    end if;
  end if;

  return new;
end;
$$;

insert into job_timeline_events (job_id, event_type, actor_type, to_status, payload, created_at)
select
  job.id,
  'job_reserved',
  'system',
  job.status,
  jsonb_build_object(
    'workflowId', job.workflow_id,
    'orchestrationMode', job.orchestration_mode,
    'operation', job.operation,
    'idempotencyKey', job.idempotency_key,
    'backfilled', true
  ),
  job.created_at
from generation_jobs job
where not exists (
  select 1
  from job_timeline_events event
  where event.job_id = job.id
    and event.event_type = 'job_reserved'
);

drop trigger if exists generation_jobs_record_timeline on generation_jobs;
create trigger generation_jobs_record_timeline
after insert or update on generation_jobs
for each row execute function record_generation_job_timeline();

create or replace function record_job_dependency_timeline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into job_timeline_events (job_id, event_type, actor_type, payload)
  values (
    new.job_id,
    'dependency_added',
    'system',
    jsonb_build_object('dependsOnJobId', new.depends_on_job_id)
  );
  return new;
end;
$$;

drop trigger if exists job_dependencies_record_timeline on job_dependencies;
create trigger job_dependencies_record_timeline
after insert on job_dependencies
for each row execute function record_job_dependency_timeline();

create or replace function record_job_attempt_timeline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into job_timeline_events (job_id, event_type, actor_type, actor_id, payload)
  values (
    new.job_id,
    case when tg_op = 'INSERT' then 'attempt_started' else 'attempt_updated' end,
    'provider',
    new.provider,
    jsonb_strip_nulls(jsonb_build_object(
      'attemptNumber', new.attempt_number,
      'provider', new.provider,
      'providerModel', new.provider_model,
      'providerJobId', new.provider_job_id,
      'status', new.status,
      'costUsd', new.cost_usd,
      'errorCategory', new.error_category,
      'errorMessage', new.error_message,
      'finishedAt', new.finished_at
    ))
  );
  return new;
end;
$$;

insert into job_timeline_events (job_id, event_type, actor_type, actor_id, payload, created_at)
select
  attempt.job_id,
  'attempt_started',
  'provider',
  attempt.provider,
  jsonb_strip_nulls(jsonb_build_object(
    'attemptNumber', attempt.attempt_number,
    'provider', attempt.provider,
    'providerModel', attempt.provider_model,
    'providerJobId', attempt.provider_job_id,
    'status', attempt.status,
    'costUsd', attempt.cost_usd,
    'errorCategory', attempt.error_category,
    'errorMessage', attempt.error_message,
    'finishedAt', attempt.finished_at,
    'backfilled', true
  )),
  attempt.started_at
from job_attempts attempt
where not exists (
  select 1
  from job_timeline_events event
  where event.job_id = attempt.job_id
    and event.event_type = 'attempt_started'
    and event.payload ->> 'attemptNumber' = attempt.attempt_number::text
);

drop trigger if exists job_attempts_record_timeline on job_attempts;
create trigger job_attempts_record_timeline
after insert or update on job_attempts
for each row execute function record_job_attempt_timeline();

alter table job_dependencies enable row level security;
alter table job_timeline_events enable row level security;

drop policy if exists job_dependencies_select_own on job_dependencies;
create policy job_dependencies_select_own on job_dependencies
for select using (
  exists (
    select 1
    from generation_jobs
    where generation_jobs.id = job_dependencies.job_id
      and owns_project(generation_jobs.project_id)
  )
);

drop policy if exists job_timeline_events_select_own on job_timeline_events;
create policy job_timeline_events_select_own on job_timeline_events
for select using (
  exists (
    select 1
    from generation_jobs
    where generation_jobs.id = job_timeline_events.job_id
      and owns_project(generation_jobs.project_id)
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
        'queued',
        'submitting',
        'provider_running',
        'repairing'
      )
      and (candidate_job.lease_expires_at is null or candidate_job.lease_expires_at < now())
      and not exists (
        select 1
        from job_dependencies dependency
        join generation_jobs predecessor on predecessor.id = dependency.depends_on_job_id
        where dependency.job_id = candidate_job.id
          and predecessor.status <> 'completed'
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_generation_job(text, integer) to service_role;
  end if;
end $$;
