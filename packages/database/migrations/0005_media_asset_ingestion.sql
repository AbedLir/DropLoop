alter table project_assets
  add column if not exists role text not null default 'mood_reference',
  add column if not exists version integer not null default 1,
  add column if not exists status text not null default 'ready',
  add column if not exists content_sha256 text,
  add column if not exists duration_seconds double precision,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists frame_rate double precision,
  add column if not exists codec text,
  add column if not exists pixel_format text,
  add column if not exists has_alpha boolean;

create unique index if not exists project_assets_project_content_sha256
  on project_assets (project_id, content_sha256)
  where content_sha256 is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_assets_type_check') then
    alter table project_assets
      add constraint project_assets_type_check
      check (type in ('audio', 'image', 'video'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_role_check') then
    alter table project_assets
      add constraint project_assets_role_check
      check (role in ('source_audio', 'mood_reference', 'generated_output', 'playable_preview'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_role_type_check') then
    alter table project_assets
      add constraint project_assets_role_type_check
      check (
        (role = 'source_audio' and type = 'audio')
        or (role = 'mood_reference' and type in ('image', 'video'))
        or role in ('generated_output', 'playable_preview')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_status_check') then
    alter table project_assets
      add constraint project_assets_status_check
      check (status in ('ready', 'rejected'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_version_check') then
    alter table project_assets
      add constraint project_assets_version_check check (version > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_size_check') then
    alter table project_assets
      add constraint project_assets_size_check check (size_bytes > 0 and size_bytes <= 67108864);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_sha256_check') then
    alter table project_assets
      add constraint project_assets_sha256_check
      check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'project_assets_media_metadata_check') then
    alter table project_assets
      add constraint project_assets_media_metadata_check
      check (
        (type = 'audio' and duration_seconds > 0 and codec is not null)
        or (type = 'image' and width > 0 and height > 0 and codec is not null)
        or (
          type = 'video'
          and duration_seconds > 0
          and width > 0
          and height > 0
          and frame_rate > 0
          and codec is not null
        )
      );
  end if;
end $$;

drop policy if exists project_assets_insert_own on project_assets;
drop policy if exists project_assets_update_own on project_assets;
drop policy if exists project_assets_storage_update_own on storage.objects;

create or replace function register_project_asset(
  p_asset_id uuid,
  p_project_id uuid,
  p_type text,
  p_role text,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_duration_seconds double precision,
  p_width integer,
  p_height integer,
  p_frame_rate double precision,
  p_codec text,
  p_pixel_format text,
  p_has_alpha boolean,
  p_metadata jsonb
)
returns setof project_assets
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  current_user_id uuid := auth.uid();
  expected_prefix text;
  existing_asset project_assets%rowtype;
  created_asset project_assets%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from projects
    where id = p_project_id and user_id = current_user_id
  ) then
    raise exception 'project not found for authenticated owner' using errcode = 'P0002';
  end if;

  if p_asset_id is null then
    raise exception 'asset id is required';
  end if;

  expected_prefix := current_user_id::text || '/' || p_project_id::text || '/sources/' || p_asset_id::text || '/';
  if p_storage_path is null or position(expected_prefix in p_storage_path) <> 1 then
    raise exception 'storage path must use the authenticated immutable asset prefix' using errcode = '42501';
  end if;

  if p_filename is null or length(trim(p_filename)) = 0 or p_filename like '%/%' then
    raise exception 'safe asset filename is required';
  end if;

  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'valid sha256 digest is required';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'asset metadata must be a JSON object';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'project-assets' and name = p_storage_path
  ) then
    raise exception 'uploaded storage object not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('asset:' || current_user_id::text || ':' || p_project_id::text || ':' || p_content_sha256, 0)
  );

  select asset.* into existing_asset
  from project_assets asset
  where asset.id = p_asset_id;

  if found then
    if existing_asset.project_id <> p_project_id
      or existing_asset.storage_path <> p_storage_path
      or existing_asset.content_sha256 <> p_content_sha256 then
      raise exception 'asset id already belongs to a different immutable payload';
    end if;

    return next existing_asset;
    return;
  end if;

  insert into project_assets (
    id,
    project_id,
    type,
    role,
    url,
    filename,
    mime_type,
    size_bytes,
    storage_bucket,
    storage_path,
    status,
    version,
    content_sha256,
    duration_seconds,
    width,
    height,
    frame_rate,
    codec,
    pixel_format,
    has_alpha,
    metadata
  )
  values (
    p_asset_id,
    p_project_id,
    p_type,
    p_role,
    'storage://project-assets/' || p_storage_path,
    trim(p_filename),
    p_mime_type,
    p_size_bytes,
    'project-assets',
    p_storage_path,
    'ready',
    1,
    p_content_sha256,
    p_duration_seconds,
    p_width,
    p_height,
    p_frame_rate,
    p_codec,
    p_pixel_format,
    p_has_alpha,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into created_asset;

  return next created_asset;
end;
$$;

revoke all on function register_project_asset(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  double precision,
  integer,
  integer,
  double precision,
  text,
  text,
  boolean,
  jsonb
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function register_project_asset(
      uuid,
      uuid,
      text,
      text,
      text,
      text,
      text,
      bigint,
      text,
      double precision,
      integer,
      integer,
      double precision,
      text,
      text,
      boolean,
      jsonb
    ) to authenticated;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = 67108864 where id = ''project-assets''';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $storage$
      update storage.buckets
      set allowed_mime_types = array[
        'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/flac',
        'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/quicktime', 'video/webm'
      ]::text[]
      where id = 'project-assets'
    $storage$;
  end if;
end $$;
