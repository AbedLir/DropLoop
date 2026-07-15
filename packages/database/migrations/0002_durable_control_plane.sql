alter table projects
  add column if not exists desired_mood text,
  add column if not exists show_type text,
  add column if not exists version integer not null default 1;

alter table users_profile
  alter column email drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_profile_auth_user_fk') then
    alter table users_profile
      add constraint users_profile_auth_user_fk
      foreign key (id) references auth.users(id) on delete cascade
      not valid;
  end if;
end $$;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into users_profile (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_created_profile on auth.users;
create trigger auth_user_created_profile
after insert on auth.users
for each row execute function handle_new_auth_user();

alter table project_assets
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table generation_jobs
  add column if not exists operation text not null default 'generate',
  add column if not exists idempotency_key text,
  add column if not exists input jsonb not null default '{}'::jsonb,
  add column if not exists provider text,
  add column if not exists provider_job_id text,
  add column if not exists provider_model text,
  add column if not exists provider_config jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists cost_usd numeric(12, 6) not null default 0,
  add column if not exists error_category text,
  add column if not exists leased_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update generation_jobs
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

update generation_jobs
set status = 'provider_running'
where status = 'running';

alter table generation_jobs
  alter column idempotency_key set not null;

create unique index if not exists generation_jobs_project_idempotency_key
  on generation_jobs (project_id, idempotency_key);

create index if not exists generation_jobs_claimable
  on generation_jobs (status, lease_expires_at, created_at);

create index if not exists generation_jobs_provider_job
  on generation_jobs (provider, provider_job_id)
  where provider_job_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_status_check') then
    alter table generation_jobs
      add constraint generation_jobs_status_check
      check (status in (
        'queued',
        'submitting',
        'provider_running',
        'downloading',
        'validating',
        'awaiting_review',
        'repairing',
        'exporting',
        'completed',
        'failed',
        'cancelled'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_operation_check') then
    alter table generation_jobs
      add constraint generation_jobs_operation_check
      check (operation in ('generate', 'repair', 'export'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_progress_check') then
    alter table generation_jobs
      add constraint generation_jobs_progress_check check (progress between 0 and 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_attempts_check') then
    alter table generation_jobs
      add constraint generation_jobs_attempts_check
      check (attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'generation_jobs_cost_check') then
    alter table generation_jobs
      add constraint generation_jobs_cost_check check (cost_usd >= 0);
  end if;
end $$;

create table if not exists job_attempts (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid not null references generation_jobs(id) on delete cascade,
  attempt_number integer not null,
  provider text not null,
  provider_model text,
  provider_job_id text,
  status text not null,
  cost_usd numeric(12, 6) not null default 0,
  raw_response jsonb,
  error_category text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt_number),
  unique (provider, provider_job_id),
  check (attempt_number > 0),
  check (cost_usd >= 0),
  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'))
);

create table if not exists review_actions (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  clip_id uuid not null references clips(id) on delete cascade,
  user_id uuid not null references users_profile(id),
  action text not null,
  reason text,
  created_at timestamptz not null default now(),
  check (action in ('approve', 'reject', 'repair', 'regenerate'))
);

create index if not exists review_actions_project_created
  on review_actions (project_id, created_at desc);

create table if not exists exports (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  job_id uuid references generation_jobs(id),
  version integer not null,
  preset text not null,
  status text not null default 'queued',
  storage_bucket text,
  storage_path text,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version),
  check (version > 0),
  check (status in ('queued', 'exporting', 'completed', 'failed', 'cancelled'))
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
before update on projects
for each row execute function set_updated_at();

drop trigger if exists project_assets_set_updated_at on project_assets;
create trigger project_assets_set_updated_at
before update on project_assets
for each row execute function set_updated_at();

drop trigger if exists generation_jobs_set_updated_at on generation_jobs;
create trigger generation_jobs_set_updated_at
before update on generation_jobs
for each row execute function set_updated_at();

drop trigger if exists exports_set_updated_at on exports;
create trigger exports_set_updated_at
before update on exports
for each row execute function set_updated_at();

create or replace function owns_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from projects
    where id = target_project_id
      and user_id = auth.uid()
  );
$$;

alter table job_attempts enable row level security;
alter table review_actions enable row level security;
alter table exports enable row level security;

drop policy if exists users_profile_select_own on users_profile;
create policy users_profile_select_own on users_profile
for select using (id = auth.uid());

drop policy if exists users_profile_update_own on users_profile;
create policy users_profile_update_own on users_profile
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists projects_select_own on projects;
create policy projects_select_own on projects
for select using (user_id = auth.uid());

drop policy if exists projects_insert_own on projects;
create policy projects_insert_own on projects
for insert with check (user_id = auth.uid());

drop policy if exists projects_update_own on projects;
create policy projects_update_own on projects
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists projects_delete_own on projects;
create policy projects_delete_own on projects
for delete using (user_id = auth.uid());

drop policy if exists project_assets_select_own on project_assets;
create policy project_assets_select_own on project_assets
for select using (owns_project(project_id));

drop policy if exists project_assets_insert_own on project_assets;
create policy project_assets_insert_own on project_assets
for insert with check (owns_project(project_id));

drop policy if exists project_assets_update_own on project_assets;
create policy project_assets_update_own on project_assets
for update using (owns_project(project_id)) with check (owns_project(project_id));

drop policy if exists project_assets_delete_own on project_assets;
create policy project_assets_delete_own on project_assets
for delete using (owns_project(project_id));

drop policy if exists generation_jobs_select_own on generation_jobs;
create policy generation_jobs_select_own on generation_jobs
for select using (owns_project(project_id));

drop policy if exists generation_jobs_insert_own on generation_jobs;
create policy generation_jobs_insert_own on generation_jobs
for insert with check (owns_project(project_id));

drop policy if exists clips_select_own on clips;
create policy clips_select_own on clips
for select using (owns_project(project_id));

drop policy if exists review_actions_select_own on review_actions;
create policy review_actions_select_own on review_actions
for select using (owns_project(project_id));

drop policy if exists review_actions_insert_own on review_actions;
create policy review_actions_insert_own on review_actions
for insert with check (owns_project(project_id) and user_id = auth.uid());

drop policy if exists exports_select_own on exports;
create policy exports_select_own on exports
for select using (owns_project(project_id));

drop policy if exists job_attempts_select_own on job_attempts;
create policy job_attempts_select_own on job_attempts
for select using (
  exists (
    select 1
    from generation_jobs
    where generation_jobs.id = job_attempts.job_id
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
    select id
    from generation_jobs
    where operation in ('generate', 'repair')
      and status in (
        'queued',
        'submitting',
        'provider_running',
        'repairing'
      )
      and (lease_expires_at is null or lease_expires_at < now())
    order by created_at
    for update skip locked
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

create or replace function release_generation_job_lease(target_job_id uuid, worker_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  update generation_jobs
  set leased_by = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target_job_id
    and leased_by = worker_id;

  get diagnostics released_count = row_count;
  return released_count = 1;
end;
$$;

revoke all on function claim_generation_job(text, integer) from public;
revoke all on function release_generation_job_lease(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_generation_job(text, integer) to service_role;
    grant execute on function release_generation_job_lease(uuid, text) to service_role;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('project-assets', 'project-assets', false)
    on conflict (id) do nothing;
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists project_assets_storage_select_own on storage.objects';
    execute 'create policy project_assets_storage_select_own on storage.objects for select using (bucket_id = ''project-assets'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'drop policy if exists project_assets_storage_insert_own on storage.objects';
    execute 'create policy project_assets_storage_insert_own on storage.objects for insert with check (bucket_id = ''project-assets'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'drop policy if exists project_assets_storage_update_own on storage.objects';
    execute 'create policy project_assets_storage_update_own on storage.objects for update using (bucket_id = ''project-assets'' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = ''project-assets'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'drop policy if exists project_assets_storage_delete_own on storage.objects';
    execute 'create policy project_assets_storage_delete_own on storage.objects for delete using (bucket_id = ''project-assets'' and (storage.foldername(name))[1] = auth.uid()::text)';
  end if;
end $$;
