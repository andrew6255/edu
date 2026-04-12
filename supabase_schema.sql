create extension if not exists pgcrypto;

create table if not exists profiles (
  id text primary key,
  email text unique,
  username text unique,
  first_name text,
  last_name text,
  role text not null default 'student' check (role in ('student', 'superadmin')),
  class_id text,
  onboarding_complete boolean,
  curriculum_profile jsonb,
  arena_stats jsonb,
  user_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_economy (
  user_id text primary key references profiles(id) on delete cascade,
  gold integer not null default 0,
  global_xp integer not null default 0,
  streak integer not null default 0,
  energy integer not null default 0,
  ranked_energy_streak integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table profiles add column if not exists class_id text;
alter table profiles add column if not exists onboarding_complete boolean;
alter table profiles add column if not exists curriculum_profile jsonb;
alter table profiles add column if not exists arena_stats jsonb;
alter table profiles add column if not exists user_state jsonb;

alter table user_economy drop constraint if exists user_economy_user_id_fkey;
alter table logic_game_progress drop constraint if exists logic_game_progress_user_id_fkey;
alter table question_progress drop constraint if exists question_progress_user_id_fkey;
alter table assets drop constraint if exists assets_owner_user_id_fkey;

alter table profiles alter column id type text using id::text;
alter table user_economy alter column user_id type text using user_id::text;
alter table logic_game_progress alter column user_id type text using user_id::text;
alter table question_progress alter column user_id type text using user_id::text;
alter table assets alter column owner_user_id type text using owner_user_id::text;

alter table user_economy add constraint user_economy_user_id_fkey foreign key (user_id) references profiles(id) on delete cascade;
alter table logic_game_progress add constraint logic_game_progress_user_id_fkey foreign key (user_id) references profiles(id) on delete cascade;
alter table question_progress add constraint question_progress_user_id_fkey foreign key (user_id) references profiles(id) on delete cascade;
alter table assets add constraint assets_owner_user_id_fkey foreign key (owner_user_id) references profiles(id) on delete set null;

alter table user_economy add column if not exists streak integer not null default 0;
alter table user_economy add column if not exists energy integer not null default 0;
alter table user_economy add column if not exists ranked_energy_streak integer not null default 0;

create table if not exists public_programs (
  id text primary key,
  title text not null,
  subject text not null default 'mathematics',
  grade_band text,
  cover_emoji text,
  builder_spec jsonb,
  toc jsonb,
  annotations jsonb,
  program_meta jsonb,
  question_banks_by_chapter jsonb,
  ranked_total_question_count integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists draft_programs (
  id text primary key,
  title text not null,
  subject text not null default 'mathematics',
  grade_band text,
  cover_emoji text,
  builder_spec jsonb,
  toc jsonb,
  annotations jsonb,
  program_meta jsonb,
  question_banks_by_chapter jsonb,
  ranked_total_question_count integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists logic_game_nodes_public (
  id text primary key,
  iq integer not null,
  label text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists logic_game_nodes_draft (
  id text primary key,
  iq integer not null,
  label text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists logic_game_questions_public (
  id uuid primary key default gen_random_uuid(),
  node_id text not null references logic_game_nodes_public(id) on delete cascade,
  question_id text not null,
  prompt_blocks jsonb,
  prompt_raw_text text,
  prompt_latex text,
  interaction jsonb not null,
  time_limit_sec integer not null,
  iq_delta_correct integer not null,
  iq_delta_wrong integer not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (node_id, question_id)
);

create table if not exists logic_game_questions_draft (
  id uuid primary key default gen_random_uuid(),
  node_id text not null references logic_game_nodes_draft(id) on delete cascade,
  question_id text not null,
  prompt_blocks jsonb,
  prompt_raw_text text,
  prompt_latex text,
  interaction jsonb not null,
  time_limit_sec integer not null,
  iq_delta_correct integer not null,
  iq_delta_wrong integer not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (node_id, question_id)
);

create table if not exists logic_game_progress (
  user_id text primary key references profiles(id) on delete cascade,
  iq integer not null default 80,
  floor_iq integer not null default 80,
  updated_at timestamptz not null default now()
);

create table if not exists question_progress (
  user_id text not null references profiles(id) on delete cascade,
  program_id text not null references public_programs(id) on delete cascade,
  question_id text not null,
  solved boolean not null default false,
  last_answered_at timestamptz,
  primary key (user_id, program_id, question_id)
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text references profiles(id) on delete set null,
  program_id text,
  bucket text not null,
  path text not null,
  public_url text,
  mime_type text,
  size_bytes bigint,
  kind text,
  created_at timestamptz not null default now()
);

-- ─── Generic document store (replaces Firebase Firestore) ─────────────────────

create table if not exists user_docs (
  user_id text not null references profiles(id) on delete cascade,
  collection text not null,
  doc_id text not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, doc_id)
);

create table if not exists global_docs (
  collection text not null,
  doc_id text not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (collection, doc_id)
);

create index if not exists idx_user_docs_collection on user_docs(user_id, collection);
create index if not exists idx_global_docs_collection on global_docs(collection);
create index if not exists idx_global_docs_data on global_docs using gin (data);

alter table user_docs enable row level security;
alter table global_docs enable row level security;

drop policy if exists user_docs_select_own on user_docs;
create policy user_docs_select_own on user_docs for select to authenticated using (auth.uid()::text = user_id);

drop policy if exists user_docs_insert_own on user_docs;
create policy user_docs_insert_own on user_docs for insert to authenticated with check (auth.uid()::text = user_id);

drop policy if exists user_docs_update_own on user_docs;
create policy user_docs_update_own on user_docs for update to authenticated using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists user_docs_delete_own on user_docs;
create policy user_docs_delete_own on user_docs for delete to authenticated using (auth.uid()::text = user_id);

drop policy if exists global_docs_select_all on global_docs;
create policy global_docs_select_all on global_docs for select to authenticated using (true);

drop policy if exists global_docs_insert_auth on global_docs;
create policy global_docs_insert_auth on global_docs for insert to authenticated with check (true);

drop policy if exists global_docs_update_auth on global_docs;
create policy global_docs_update_auth on global_docs for update to authenticated using (true) with check (true);

drop policy if exists global_docs_delete_auth on global_docs;
create policy global_docs_delete_auth on global_docs for delete to authenticated using (true);

-- ─── Superadmin helper: change another user's role (bypasses RLS) ─────────────

create or replace function admin_update_user_role(target_uid text, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  ) then
    raise exception 'Forbidden: caller is not a superadmin';
  end if;

  if new_role not in ('student', 'superadmin') then
    raise exception 'Invalid role: %', new_role;
  end if;

  update profiles set role = new_role where id = target_uid;
end;
$$;

-- ─── Superadmin helper: delete app data for a user (bypasses RLS) ─────────────
-- Auth user deletion is handled client-side via supabase.auth.admin.deleteUser()

create or replace function admin_delete_user(target_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only superadmins may call this
  if not exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  ) then
    raise exception 'Forbidden: caller is not a superadmin';
  end if;

  delete from user_docs    where user_id = target_uid;
  delete from user_economy where user_id = target_uid;
  delete from logic_game_progress where user_id = target_uid;
  delete from question_progress   where user_id = target_uid;
  delete from profiles     where id = target_uid;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────────

create index if not exists idx_public_programs_title on public_programs(title);
create index if not exists idx_draft_programs_title on draft_programs(title);
create index if not exists idx_logic_game_nodes_public_order on logic_game_nodes_public(sort_order);
create index if not exists idx_logic_game_nodes_draft_order on logic_game_nodes_draft(sort_order);
create index if not exists idx_logic_game_questions_public_node_id on logic_game_questions_public(node_id);
create index if not exists idx_logic_game_questions_draft_node_id on logic_game_questions_draft(node_id);
create index if not exists idx_assets_program_id on assets(program_id);

alter table profiles enable row level security;
alter table user_economy enable row level security;
alter table public_programs enable row level security;
alter table draft_programs enable row level security;
alter table logic_game_nodes_public enable row level security;
alter table logic_game_nodes_draft enable row level security;
alter table logic_game_questions_public enable row level security;
alter table logic_game_questions_draft enable row level security;
alter table logic_game_progress enable row level security;
alter table question_progress enable row level security;
alter table assets enable row level security;

drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles for select to authenticated using (true);

drop policy if exists profiles_select_anon on profiles;
create policy profiles_select_anon on profiles for select to anon using (true);

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert to authenticated with check (auth.uid()::text = id);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated using (auth.uid()::text = id) with check (auth.uid()::text = id);

drop policy if exists user_economy_select_own on user_economy;
create policy user_economy_select_own on user_economy for select to authenticated using (auth.uid()::text = user_id);

drop policy if exists user_economy_insert_own on user_economy;
create policy user_economy_insert_own on user_economy for insert to authenticated with check (auth.uid()::text = user_id);

drop policy if exists user_economy_update_own on user_economy;
create policy user_economy_update_own on user_economy for update to authenticated using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists logic_game_progress_select_own on logic_game_progress;
create policy logic_game_progress_select_own on logic_game_progress for select to authenticated using (auth.uid()::text = user_id);

drop policy if exists logic_game_progress_insert_own on logic_game_progress;
create policy logic_game_progress_insert_own on logic_game_progress for insert to authenticated with check (auth.uid()::text = user_id);

drop policy if exists logic_game_progress_update_own on logic_game_progress;
create policy logic_game_progress_update_own on logic_game_progress for update to authenticated using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists question_progress_select_own on question_progress;
create policy question_progress_select_own on question_progress for select to authenticated using (auth.uid()::text = user_id);

drop policy if exists question_progress_insert_own on question_progress;
create policy question_progress_insert_own on question_progress for insert to authenticated with check (auth.uid()::text = user_id);

drop policy if exists question_progress_update_own on question_progress;
create policy question_progress_update_own on question_progress for update to authenticated using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists public_programs_read_all on public_programs;
create policy public_programs_read_all on public_programs for select using (true);

drop policy if exists logic_game_nodes_public_read_all on logic_game_nodes_public;
create policy logic_game_nodes_public_read_all on logic_game_nodes_public for select using (true);

drop policy if exists logic_game_questions_public_read_all on logic_game_questions_public;
create policy logic_game_questions_public_read_all on logic_game_questions_public for select using (true);

drop policy if exists assets_read_all on assets;
create policy assets_read_all on assets for select using (true);

drop policy if exists assets_insert_own on assets;
create policy assets_insert_own on assets for insert to authenticated with check (owner_user_id is null or owner_user_id = auth.uid()::text);

drop policy if exists assets_update_own on assets;
create policy assets_update_own on assets for update to authenticated using (owner_user_id is null or owner_user_id = auth.uid()::text) with check (owner_user_id is null or owner_user_id = auth.uid()::text);
