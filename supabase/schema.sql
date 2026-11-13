-- =============================================================================
-- MOD VAULT — Supabase PostgreSQL Schema + Owner-Only RLS (Google Drive Storage)
-- =============================================================================
-- Run this script in Supabase Dashboard -> SQL Editor.
-- Safe to re-run when upgrading an existing MOD VAULT database from Supabase
-- Storage to Google Drive storage.
-- IMPORTANT: Replace 'abhayn20234@gmail.com' below with your exact OWNER_EMAIL
-- if you change the owner email address.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Helper function to enforce single-owner email at the database layer
-- -----------------------------------------------------------------------------
create or replace function public.is_vault_owner(row_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and auth.uid() = row_owner_id
    and lower(coalesce(auth.jwt() ->> 'email', '')) = lower('abhayn20234@gmail.com');
$$;

-- -----------------------------------------------------------------------------
-- 2. Trigger helper for automatic updated_at timestamps
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Categories table (Mods)
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  slug text not null check (char_length(trim(slug)) between 1 and 100),
  description text not null default '',
  accent_color text not null default '#8B5CF6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_owner_slug_unique unique (owner_id, slug),
  constraint categories_owner_name_unique unique (owner_id, name)
);

create index if not exists idx_categories_owner_id on public.categories(owner_id);

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Mods table
-- -----------------------------------------------------------------------------
create table if not exists public.mods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 140),
  slug text not null check (char_length(trim(slug)) between 1 and 160),
  description text not null default '',
  loader text not null check (loader in ('Forge', 'Fabric', 'NeoForge', 'Quilt')),
  latest_mc_version text not null check (char_length(trim(latest_mc_version)) between 1 and 40),
  thumbnail_key text,
  thumbnail_drive_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mods_owner_slug_unique unique (owner_id, slug)
);

alter table public.mods add column if not exists thumbnail_drive_id text;

create index if not exists idx_mods_owner_id on public.mods(owner_id);
create index if not exists idx_mods_category_id on public.mods(category_id);
create index if not exists idx_mods_loader on public.mods(loader);
create index if not exists idx_mods_latest_mc_version on public.mods(latest_mc_version);
create index if not exists idx_mods_updated_at on public.mods(updated_at desc);

drop trigger if exists trg_mods_updated_at on public.mods;
create trigger trg_mods_updated_at
  before update on public.mods
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Mod Versions table (Binary .jar files stored privately in Google Drive)
-- -----------------------------------------------------------------------------
create table if not exists public.mod_versions (
  id uuid primary key default gen_random_uuid(),
  mod_id uuid not null references public.mods(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version_number text not null check (char_length(trim(version_number)) between 1 and 64),
  mc_version text not null check (char_length(trim(mc_version)) between 1 and 40),
  loader text not null check (loader in ('Forge', 'Fabric', 'NeoForge', 'Quilt')),
  file_name text not null check (file_name ~* '\.jar$'),
  mime_type text not null default 'application/java-archive',
  drive_file_id text unique,
  drive_parent_id text,
  storage_path text unique,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  changelog text not null default '',
  created_at timestamptz not null default now(),
  constraint mod_versions_unique_release unique (mod_id, version_number, mc_version, loader),
  constraint mod_versions_owner_sha256_unique unique (owner_id, sha256)
);

-- Safe migration when upgrading from earlier Supabase Storage / R2 schemas
alter table public.mod_versions add column if not exists mime_type text not null default 'application/java-archive';
alter table public.mod_versions add column if not exists drive_file_id text;
alter table public.mod_versions add column if not exists drive_parent_id text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mod_versions' and column_name = 'storage_path'
  ) then
    alter table public.mod_versions alter column storage_path drop not null;
  end if;
end $$;

create unique index if not exists idx_mod_versions_drive_file_id
  on public.mod_versions(drive_file_id)
  where drive_file_id is not null;
create index if not exists idx_mod_versions_mod_id on public.mod_versions(mod_id);
create index if not exists idx_mod_versions_owner_id on public.mod_versions(owner_id);
create index if not exists idx_mod_versions_mc_version on public.mod_versions(mc_version);
create index if not exists idx_mod_versions_loader on public.mod_versions(loader);
create index if not exists idx_mod_versions_created_at on public.mod_versions(created_at desc);

-- -----------------------------------------------------------------------------
-- 6. Vault Folders table (Mirrored to private Google Drive folder hierarchy)
-- -----------------------------------------------------------------------------
create table if not exists public.vault_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.vault_folders(id) on delete cascade,
  drive_folder_id text unique,
  drive_parent_id text,
  name text not null check (
    char_length(trim(name)) between 1 and 120
    and name !~ '[/\\]'
    and name <> '.'
    and name <> '..'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vault_folders add column if not exists drive_folder_id text;
alter table public.vault_folders add column if not exists drive_parent_id text;

create unique index if not exists idx_vault_folders_drive_folder_id
  on public.vault_folders(drive_folder_id)
  where drive_folder_id is not null;

create unique index if not exists idx_vault_folders_unique_root
  on public.vault_folders(owner_id, lower(name))
  where parent_id is null;

create unique index if not exists idx_vault_folders_unique_child
  on public.vault_folders(owner_id, parent_id, lower(name))
  where parent_id is not null;

create index if not exists idx_vault_folders_owner_id on public.vault_folders(owner_id);
create index if not exists idx_vault_folders_parent_id on public.vault_folders(parent_id);

drop trigger if exists trg_vault_folders_updated_at on public.vault_folders;
create trigger trg_vault_folders_updated_at
  before update on public.vault_folders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Vault Files table (Any file type stored privately in Google Drive)
-- -----------------------------------------------------------------------------
create table if not exists public.vault_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.vault_folders(id) on delete cascade,
  name text not null check (
    char_length(trim(name)) between 1 and 200
    and name !~ '[/\\]'
  ),
  file_extension text not null default '',
  mime_type text not null default 'application/octet-stream',
  drive_file_id text unique,
  drive_parent_id text,
  storage_path text unique,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe migration when upgrading from earlier Supabase Storage / R2 schemas
alter table public.vault_files add column if not exists drive_file_id text;
alter table public.vault_files add column if not exists drive_parent_id text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vault_files' and column_name = 'storage_path'
  ) then
    alter table public.vault_files alter column storage_path drop not null;
  end if;
end $$;

create unique index if not exists idx_vault_files_drive_file_id
  on public.vault_files(drive_file_id)
  where drive_file_id is not null;
create index if not exists idx_vault_files_owner_id on public.vault_files(owner_id);
create index if not exists idx_vault_files_folder_id on public.vault_files(folder_id);
create index if not exists idx_vault_files_extension on public.vault_files(file_extension);
create index if not exists idx_vault_files_created_at on public.vault_files(created_at desc);

drop trigger if exists trg_vault_files_updated_at on public.vault_files;
create trigger trg_vault_files_updated_at
  before update on public.vault_files
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. Row Level Security (RLS) — Database Tables
-- -----------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.mods enable row level security;
alter table public.mod_versions enable row level security;
alter table public.vault_folders enable row level security;
alter table public.vault_files enable row level security;

drop policy if exists "categories_owner_select" on public.categories;
drop policy if exists "categories_owner_insert" on public.categories;
drop policy if exists "categories_owner_update" on public.categories;
drop policy if exists "categories_owner_delete" on public.categories;
drop policy if exists "categories_owner_all" on public.categories;
create policy "categories_owner_all" on public.categories
  for all using (public.is_vault_owner(owner_id))
  with check (public.is_vault_owner(owner_id));

drop policy if exists "mods_owner_select" on public.mods;
drop policy if exists "mods_owner_insert" on public.mods;
drop policy if exists "mods_owner_update" on public.mods;
drop policy if exists "mods_owner_delete" on public.mods;
drop policy if exists "mods_owner_all" on public.mods;
create policy "mods_owner_all" on public.mods
  for all using (public.is_vault_owner(owner_id))
  with check (public.is_vault_owner(owner_id));

drop policy if exists "mod_versions_owner_select" on public.mod_versions;
drop policy if exists "mod_versions_owner_insert" on public.mod_versions;
drop policy if exists "mod_versions_owner_update" on public.mod_versions;
drop policy if exists "mod_versions_owner_delete" on public.mod_versions;
drop policy if exists "mod_versions_owner_all" on public.mod_versions;
create policy "mod_versions_owner_all" on public.mod_versions
  for all using (public.is_vault_owner(owner_id))
  with check (public.is_vault_owner(owner_id));

drop policy if exists "vault_folders_owner_all" on public.vault_folders;
create policy "vault_folders_owner_all" on public.vault_folders
  for all using (public.is_vault_owner(owner_id))
  with check (public.is_vault_owner(owner_id));

drop policy if exists "vault_files_owner_all" on public.vault_files;
create policy "vault_files_owner_all" on public.vault_files
  for all using (public.is_vault_owner(owner_id))
  with check (public.is_vault_owner(owner_id));

-- -----------------------------------------------------------------------------
-- 9. Backend-only Google Drive Session Store (service_role only; zero client RLS)
-- -----------------------------------------------------------------------------
create table if not exists public.vault_drive_sessions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  google_name text,
  access_token text not null,
  expires_at timestamptz not null,
  root_folder_id text,
  mods_folder_id text,
  vault_folder_id text,
  thumbnails_folder_id text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_vault_drive_sessions_updated_at on public.vault_drive_sessions;
create trigger trg_vault_drive_sessions_updated_at
  before update on public.vault_drive_sessions
  for each row execute function public.set_updated_at();

alter table public.vault_drive_sessions enable row level security;
