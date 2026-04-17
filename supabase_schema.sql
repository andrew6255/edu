create extension if not exists pgcrypto;

create table if not exists profiles (
  id text primary key,
  email text unique,
  username text unique,
  first_name text,
  last_name text,
  role text not null default 'student' check (role in ('student', 'superadmin', 'admin', 'teacher', 'teacher_assistant', 'parent')),
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

-- ─── Relationship tables ──────────────────────────────────────────────────────

create table if not exists admin_teacher_assignments (
  admin_id text not null references profiles(id) on delete cascade,
  teacher_id text not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (admin_id, teacher_id)
);

create table if not exists classes (
  id text primary key,
  teacher_id text not null references profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists class_members (
  class_id text not null references classes(id) on delete cascade,
  user_id text not null references profiles(id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'teacher_assistant')),
  created_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create table if not exists parent_student_links (
  parent_id text not null references profiles(id) on delete cascade,
  student_id text not null unique references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

-- ─── Class content: programs, assignments, quizzes ───────────────────────────

create table if not exists class_content (
  id text primary key,
  class_id text not null references classes(id) on delete cascade,
  content_type text not null check (content_type in ('program', 'assignment', 'quiz')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null,
  subject text not null default 'mathematics',
  grade_band text,
  cover_emoji text,
  -- program-specific fields (content_type = 'program')
  builder_spec jsonb,
  toc jsonb,
  annotations jsonb,
  program_meta jsonb,
  question_banks_by_chapter jsonb,
  ranked_total_question_count integer not null default 0,
  -- assignment / quiz fields (flat question list)
  questions jsonb,
  -- quiz-specific
  time_limit_minutes integer,
  -- metadata
  created_by text references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Quiz attempts ───────────────────────────────────────────────────────────

create table if not exists quiz_attempts (
  id text primary key,
  quiz_id text not null references class_content(id) on delete cascade,
  student_id text not null references profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  time_limit_minutes integer,
  answers jsonb,
  score numeric,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'graded')),
  created_at timestamptz not null default now(),
  unique (quiz_id, student_id)
);

-- ─── Class-scoped question progress ──────────────────────────────────────────

create table if not exists class_question_progress (
  user_id text not null references profiles(id) on delete cascade,
  content_id text not null references class_content(id) on delete cascade,
  question_id text not null,
  solved boolean not null default false,
  answer jsonb,
  is_correct boolean,
  manually_graded boolean not null default false,
  graded_by text references profiles(id) on delete set null,
  graded_at timestamptz,
  last_answered_at timestamptz,
  primary key (user_id, content_id, question_id)
);

-- ─── Parent reports: chat rooms & messages ───────────────────────────────────

create table if not exists chat_rooms (
  id text primary key,
  class_id text not null references classes(id) on delete cascade,
  student_id text not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);

create table if not exists chat_messages (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references chat_rooms(id) on delete cascade,
  sender_id text not null references profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

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

  if new_role not in ('student', 'superadmin', 'admin', 'teacher', 'teacher_assistant', 'parent') then
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

  delete from chat_messages where sender_id = target_uid;
  delete from chat_rooms where student_id = target_uid;
  delete from quiz_attempts where student_id = target_uid;
  delete from class_question_progress where user_id = target_uid;
  delete from class_question_progress where graded_by = target_uid;
  delete from class_members where user_id = target_uid;
  delete from admin_teacher_assignments where admin_id = target_uid or teacher_id = target_uid;
  delete from parent_student_links where parent_id = target_uid or student_id = target_uid;
  delete from user_docs    where user_id = target_uid;
  delete from user_economy where user_id = target_uid;
  delete from logic_game_progress where user_id = target_uid;
  delete from question_progress   where user_id = target_uid;
  delete from profiles     where id = target_uid;
end;
$$;

-- ─── Superadmin helper: delete a student AND their linked parent ─────────────

create or replace function admin_delete_student_and_parent(target_student_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_parent_id text;
begin
  if not exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  ) then
    raise exception 'Forbidden: caller is not a superadmin';
  end if;

  select parent_id into linked_parent_id
    from parent_student_links
    where student_id = target_student_uid;

  -- delete student data
  perform admin_delete_user(target_student_uid);

  -- delete parent data if linked
  if linked_parent_id is not null then
    perform admin_delete_user(linked_parent_id);
  end if;
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

create index if not exists idx_admin_teacher_admin on admin_teacher_assignments(admin_id);
create index if not exists idx_admin_teacher_teacher on admin_teacher_assignments(teacher_id);
create index if not exists idx_classes_teacher on classes(teacher_id);
create index if not exists idx_class_members_class on class_members(class_id);
create index if not exists idx_class_members_user on class_members(user_id);
create index if not exists idx_parent_student_student on parent_student_links(student_id);
create index if not exists idx_parent_student_parent on parent_student_links(parent_id);

-- ─── Linking codes for parent-student linking ───────────────────────────────
create table if not exists linking_codes (
  code text primary key,
  student_id text not null unique references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
alter table linking_codes enable row level security;

-- Students can create/read/delete their own codes
drop policy if exists lc_student_all on linking_codes;
create policy lc_student_all on linking_codes for all to authenticated
using (student_id = auth.uid()::text)
with check (student_id = auth.uid()::text);

-- Parents can read any code (to look it up when linking)
drop policy if exists lc_parent_select on linking_codes;
create policy lc_parent_select on linking_codes for select to authenticated
using (rls_user_role(auth.uid()::text) = 'parent');

-- Parents can delete codes they consume (after linking)
drop policy if exists lc_parent_delete on linking_codes;
create policy lc_parent_delete on linking_codes for delete to authenticated
using (rls_user_role(auth.uid()::text) = 'parent');

-- Superadmin: full access
drop policy if exists lc_superadmin_all on linking_codes;
create policy lc_superadmin_all on linking_codes for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');
create index if not exists idx_class_content_class on class_content(class_id);
create index if not exists idx_class_content_type_status on class_content(content_type, status);
create index if not exists idx_quiz_attempts_quiz on quiz_attempts(quiz_id);
create index if not exists idx_quiz_attempts_student on quiz_attempts(student_id);
create index if not exists idx_class_question_progress_content on class_question_progress(content_id);
create index if not exists idx_chat_rooms_class on chat_rooms(class_id);
create index if not exists idx_chat_rooms_student on chat_rooms(student_id);
create index if not exists idx_chat_messages_room on chat_messages(room_id);

insert into storage.buckets (id, name, public)
values ('program-assets', 'program-assets', true)
on conflict (id) do update set public = excluded.public;

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
alter table admin_teacher_assignments enable row level security;
alter table classes enable row level security;
alter table class_members enable row level security;
alter table parent_student_links enable row level security;
alter table class_content enable row level security;
alter table quiz_attempts enable row level security;
alter table class_question_progress enable row level security;
alter table chat_rooms enable row level security;
alter table chat_messages enable row level security;

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

drop policy if exists public_programs_superadmin_insert on public_programs;
create policy public_programs_superadmin_insert on public_programs for insert to authenticated
with check (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

drop policy if exists public_programs_superadmin_update on public_programs;
create policy public_programs_superadmin_update on public_programs for update to authenticated
using (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
))
with check (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

drop policy if exists public_programs_superadmin_delete on public_programs;
create policy public_programs_superadmin_delete on public_programs for delete to authenticated
using (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

drop policy if exists draft_programs_superadmin_read on draft_programs;
create policy draft_programs_superadmin_read on draft_programs for select to authenticated
using (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

drop policy if exists draft_programs_superadmin_insert on draft_programs;
create policy draft_programs_superadmin_insert on draft_programs for insert to authenticated
with check (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

drop policy if exists draft_programs_superadmin_update on draft_programs;
create policy draft_programs_superadmin_update on draft_programs for update to authenticated
using (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
))
with check (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

drop policy if exists draft_programs_superadmin_delete on draft_programs;
create policy draft_programs_superadmin_delete on draft_programs for delete to authenticated
using (exists (
  select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
));

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

drop policy if exists program_assets_read_all on storage.objects;
create policy program_assets_read_all on storage.objects for select using (bucket_id = 'program-assets');

drop policy if exists program_assets_superadmin_insert on storage.objects;
create policy program_assets_superadmin_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  )
);

drop policy if exists program_assets_superadmin_update on storage.objects;
create policy program_assets_superadmin_update on storage.objects for update to authenticated
using (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  )
)
with check (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  )
);

drop policy if exists program_assets_superadmin_delete on storage.objects;
create policy program_assets_superadmin_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'superadmin'
  )
);

-- Also allow admins to manage program-assets for classes they manage
drop policy if exists program_assets_admin_insert on storage.objects;
create policy program_assets_admin_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'admin'
  )
);

drop policy if exists program_assets_admin_update on storage.objects;
create policy program_assets_admin_update on storage.objects for update to authenticated
using (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'admin'
  )
)
with check (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'admin'
  )
);

drop policy if exists program_assets_admin_delete on storage.objects;
create policy program_assets_admin_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'program-assets'
  and exists (
    select 1 from profiles where id = auth.uid()::text and role = 'admin'
  )
);

-- ─── Security-definer helpers (break RLS recursion) ─────────────────────────
-- These functions run as the DB owner and skip RLS, so policies that need to
-- peek at a different RLS-protected table can call them without triggering
-- infinite recursion.

create or replace function rls_user_role(uid text)
returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = uid; $$;

create or replace function rls_is_class_member(uid text, cid text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from class_members where user_id = uid and class_id = cid); $$;

create or replace function rls_is_class_member_role(uid text, cid text, r text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from class_members where user_id = uid and class_id = cid and role = r); $$;

create or replace function rls_class_teacher_id(cid text)
returns text language sql stable security definer set search_path = public
as $$ select teacher_id from classes where id = cid; $$;

create or replace function rls_student_class_ids(uid text)
returns setof text language sql stable security definer set search_path = public
as $$ select class_id from class_members where user_id = uid; $$;

create or replace function rls_parent_student_ids(parent text)
returns setof text language sql stable security definer set search_path = public
as $$ select student_id from parent_student_links where parent_id = parent; $$;

create or replace function rls_admin_teacher_ids(admin text)
returns setof text language sql stable security definer set search_path = public
as $$ select teacher_id from admin_teacher_assignments where admin_id = admin; $$;

create or replace function rls_content_class_id(content_id text)
returns text language sql stable security definer set search_path = public
as $$ select class_id from class_content where id = content_id; $$;

create or replace function rls_chat_room_class_student(room_id text)
returns table(class_id text, student_id text) language sql stable security definer set search_path = public
as $$ select class_id, student_id from chat_rooms where id = room_id; $$;

create or replace function rls_is_parent_of(parent text, student text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from parent_student_links where parent_id = parent and student_id = student); $$;

-- ─── RLS: admin_teacher_assignments ──────────────────────────────────────────
-- superadmin: full access; admins: read own assignments; teachers: read own assignments

drop policy if exists ata_superadmin_all on admin_teacher_assignments;
create policy ata_superadmin_all on admin_teacher_assignments for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));

drop policy if exists ata_admin_select on admin_teacher_assignments;
create policy ata_admin_select on admin_teacher_assignments for select to authenticated
using (admin_id = auth.uid()::text);

drop policy if exists ata_teacher_select on admin_teacher_assignments;
create policy ata_teacher_select on admin_teacher_assignments for select to authenticated
using (teacher_id = auth.uid()::text);

-- ─── RLS: classes ────────────────────────────────────────────────────────────
-- superadmin: full; admin: full on classes of teachers they manage; teacher: read own

drop policy if exists classes_superadmin_all on classes;
create policy classes_superadmin_all on classes for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));

drop policy if exists classes_admin_select on classes;
create policy classes_admin_select on classes for select to authenticated
using (exists (
  select 1 from admin_teacher_assignments where admin_id = auth.uid()::text and teacher_id = classes.teacher_id
));

drop policy if exists classes_admin_insert on classes;
create policy classes_admin_insert on classes for insert to authenticated
with check (exists (
  select 1 from admin_teacher_assignments where admin_id = auth.uid()::text and teacher_id = classes.teacher_id
));

drop policy if exists classes_admin_update on classes;
create policy classes_admin_update on classes for update to authenticated
using (exists (
  select 1 from admin_teacher_assignments where admin_id = auth.uid()::text and teacher_id = classes.teacher_id
))
with check (exists (
  select 1 from admin_teacher_assignments where admin_id = auth.uid()::text and teacher_id = classes.teacher_id
));

drop policy if exists classes_admin_delete on classes;
create policy classes_admin_delete on classes for delete to authenticated
using (exists (
  select 1 from admin_teacher_assignments where admin_id = auth.uid()::text and teacher_id = classes.teacher_id
));

drop policy if exists classes_teacher_select on classes;
create policy classes_teacher_select on classes for select to authenticated
using (teacher_id = auth.uid()::text);

drop policy if exists classes_ta_select on classes;
create policy classes_ta_select on classes for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, classes.id, 'teacher_assistant'));

drop policy if exists classes_student_select on classes;
create policy classes_student_select on classes for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, classes.id, 'student'));

drop policy if exists classes_parent_select on classes;
create policy classes_parent_select on classes for select to authenticated
using (
  classes.id in (
    select cid from rls_parent_student_ids(auth.uid()::text) sid,
    lateral rls_student_class_ids(sid) cid
  )
);

-- ─── RLS: class_members ─────────────────────────────────────────────────────
-- superadmin: full; admin: full on classes of their teachers; teacher: read own classes; student/TA: read own

drop policy if exists cm_superadmin_all on class_members;
create policy cm_superadmin_all on class_members for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists cm_admin_select on class_members;
create policy cm_admin_select on class_members for select to authenticated
using (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_admin_insert on class_members;
create policy cm_admin_insert on class_members for insert to authenticated
with check (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_admin_update on class_members;
create policy cm_admin_update on class_members for update to authenticated
using (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)))
with check (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_admin_delete on class_members;
create policy cm_admin_delete on class_members for delete to authenticated
using (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_teacher_select on class_members;
create policy cm_teacher_select on class_members for select to authenticated
using (rls_class_teacher_id(class_members.class_id) = auth.uid()::text);

drop policy if exists cm_own_select on class_members;
create policy cm_own_select on class_members for select to authenticated
using (user_id = auth.uid()::text);

-- ─── RLS: parent_student_links ──────────────────────────────────────────────
-- superadmin: full; parent or student in link: read own; students: insert own link

drop policy if exists psl_superadmin_all on parent_student_links;
create policy psl_superadmin_all on parent_student_links for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists psl_own_select on parent_student_links;
create policy psl_own_select on parent_student_links for select to authenticated
using (parent_id = auth.uid()::text or student_id = auth.uid()::text);

drop policy if exists psl_student_insert on parent_student_links;
create policy psl_student_insert on parent_student_links for insert to authenticated
with check (student_id = auth.uid()::text);

drop policy if exists psl_parent_insert on parent_student_links;
create policy psl_parent_insert on parent_student_links for insert to authenticated
with check (parent_id = auth.uid()::text);

drop policy if exists psl_parent_delete on parent_student_links;
create policy psl_parent_delete on parent_student_links for delete to authenticated
using (parent_id = auth.uid()::text);

drop policy if exists psl_admin_select on parent_student_links;
create policy psl_admin_select on parent_student_links for select to authenticated
using (exists (
  select 1 from rls_student_class_ids(parent_student_links.student_id) cid
  where rls_class_teacher_id(cid) in (select rls_admin_teacher_ids(auth.uid()::text))
));

drop policy if exists psl_teacher_select on parent_student_links;
create policy psl_teacher_select on parent_student_links for select to authenticated
using (exists (
  select 1 from rls_student_class_ids(parent_student_links.student_id) cid
  where rls_class_teacher_id(cid) = auth.uid()::text
));

-- ─── RLS: class_content ─────────────────────────────────────────────────────
-- superadmin: full; admin: full on managed teacher classes; teacher: read own classes;
-- student: read published in own classes; TA: read in own classes; parent: read published in child's classes

drop policy if exists cc_superadmin_all on class_content;
create policy cc_superadmin_all on class_content for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists cc_admin_select on class_content;
create policy cc_admin_select on class_content for select to authenticated
using (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_admin_insert on class_content;
create policy cc_admin_insert on class_content for insert to authenticated
with check (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_admin_update on class_content;
create policy cc_admin_update on class_content for update to authenticated
using (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)))
with check (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_admin_delete on class_content;
create policy cc_admin_delete on class_content for delete to authenticated
using (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_teacher_select on class_content;
create policy cc_teacher_select on class_content for select to authenticated
using (rls_class_teacher_id(class_content.class_id) = auth.uid()::text);

drop policy if exists cc_ta_select on class_content;
create policy cc_ta_select on class_content for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, class_content.class_id, 'teacher_assistant'));

drop policy if exists cc_student_select on class_content;
create policy cc_student_select on class_content for select to authenticated
using (
  status = 'published'
  and rls_is_class_member_role(auth.uid()::text, class_content.class_id, 'student')
);

drop policy if exists cc_parent_select on class_content;
create policy cc_parent_select on class_content for select to authenticated
using (
  status = 'published'
  and class_content.class_id in (
    select cid from rls_parent_student_ids(auth.uid()::text) sid,
    lateral rls_student_class_ids(sid) cid
  )
);

-- ─── RLS: quiz_attempts ─────────────────────────────────────────────────────

drop policy if exists qa_superadmin_all on quiz_attempts;
create policy qa_superadmin_all on quiz_attempts for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));

drop policy if exists qa_student_own on quiz_attempts;
create policy qa_student_own on quiz_attempts for all to authenticated
using (student_id = auth.uid()::text)
with check (student_id = auth.uid()::text);

drop policy if exists qa_admin_select on quiz_attempts;
create policy qa_admin_select on quiz_attempts for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(quiz_attempts.quiz_id)) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists qa_teacher_select on quiz_attempts;
create policy qa_teacher_select on quiz_attempts for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(quiz_attempts.quiz_id)) = auth.uid()::text);

drop policy if exists qa_ta_select on quiz_attempts;
create policy qa_ta_select on quiz_attempts for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(quiz_attempts.quiz_id), 'teacher_assistant'));

drop policy if exists qa_ta_update on quiz_attempts;
create policy qa_ta_update on quiz_attempts for update to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(quiz_attempts.quiz_id), 'teacher_assistant'))
with check (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(quiz_attempts.quiz_id), 'teacher_assistant'));

-- ─── RLS: class_question_progress ───────────────────────────────────────────

drop policy if exists cqp_superadmin_all on class_question_progress;
create policy cqp_superadmin_all on class_question_progress for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));

drop policy if exists cqp_student_own on class_question_progress;
create policy cqp_student_own on class_question_progress for all to authenticated
using (user_id = auth.uid()::text)
with check (user_id = auth.uid()::text);

drop policy if exists cqp_admin_select on class_question_progress;
create policy cqp_admin_select on class_question_progress for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(class_question_progress.content_id)) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cqp_teacher_select on class_question_progress;
create policy cqp_teacher_select on class_question_progress for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(class_question_progress.content_id)) = auth.uid()::text);

drop policy if exists cqp_ta_select on class_question_progress;
create policy cqp_ta_select on class_question_progress for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(class_question_progress.content_id), 'teacher_assistant'));

drop policy if exists cqp_ta_update on class_question_progress;
create policy cqp_ta_update on class_question_progress for update to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(class_question_progress.content_id), 'teacher_assistant'))
with check (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(class_question_progress.content_id), 'teacher_assistant'));

drop policy if exists cqp_parent_select on class_question_progress;
create policy cqp_parent_select on class_question_progress for select to authenticated
using (rls_is_parent_of(auth.uid()::text, class_question_progress.user_id));

-- ─── RLS: chat_rooms ────────────────────────────────────────────────────────

drop policy if exists cr_superadmin_all on chat_rooms;
create policy cr_superadmin_all on chat_rooms for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));

drop policy if exists cr_teacher_select on chat_rooms;
create policy cr_teacher_select on chat_rooms for select to authenticated
using (rls_class_teacher_id(chat_rooms.class_id) = auth.uid()::text);

drop policy if exists cr_teacher_insert on chat_rooms;
create policy cr_teacher_insert on chat_rooms for insert to authenticated
with check (rls_class_teacher_id(chat_rooms.class_id) = auth.uid()::text);

drop policy if exists cr_ta_select on chat_rooms;
create policy cr_ta_select on chat_rooms for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, chat_rooms.class_id, 'teacher_assistant'));

drop policy if exists cr_parent_select on chat_rooms;
create policy cr_parent_select on chat_rooms for select to authenticated
using (rls_is_parent_of(auth.uid()::text, chat_rooms.student_id));

-- ─── RLS: chat_messages ─────────────────────────────────────────────────────

drop policy if exists cmsg_superadmin_all on chat_messages;
create policy cmsg_superadmin_all on chat_messages for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));

drop policy if exists cmsg_room_member_select on chat_messages;
create policy cmsg_room_member_select on chat_messages for select to authenticated
using (exists (
  select 1 from rls_chat_room_class_student(chat_messages.room_id) cr where (
    rls_class_teacher_id(cr.class_id) = auth.uid()::text
    or rls_is_class_member_role(auth.uid()::text, cr.class_id, 'teacher_assistant')
    or rls_is_parent_of(auth.uid()::text, cr.student_id)
  )
));

drop policy if exists cmsg_room_member_insert on chat_messages;
create policy cmsg_room_member_insert on chat_messages for insert to authenticated
with check (
  sender_id = auth.uid()::text
  and exists (
    select 1 from rls_chat_room_class_student(chat_messages.room_id) cr where (
      rls_class_teacher_id(cr.class_id) = auth.uid()::text
      or rls_is_class_member_role(auth.uid()::text, cr.class_id, 'teacher_assistant')
      or rls_is_parent_of(auth.uid()::text, cr.student_id)
    )
  )
);
