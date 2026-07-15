create extension if not exists "uuid-ossp";

create table if not exists users_profile (
  id uuid primary key,
  email text not null unique,
  display_name text,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users_profile(id),
  name text not null,
  status text not null default 'draft',
  template text not null,
  music_genre text,
  bpm integer,
  screen_format text not null,
  pack_size integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_assets (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,
  url text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  stage text not null,
  status text not null default 'queued',
  progress integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists clips (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  planned_clip_id text not null,
  role text not null,
  energy integer not null,
  status text not null default 'planned',
  preview_url text,
  thumbnail_url text,
  loop_score integer,
  quality_score integer,
  created_at timestamptz not null default now()
);

alter table users_profile enable row level security;
alter table projects enable row level security;
alter table project_assets enable row level security;
alter table generation_jobs enable row level security;
alter table clips enable row level security;
