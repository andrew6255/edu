-- IQ Games (logic games) authoring RLS. Apply after supabase_schema.sql and
-- fix_rls_recursion.sql (this file depends on the rls_user_role() helper).
--
-- Problem: logic_game_nodes_public / logic_game_questions_public have RLS
-- enabled but only a public SELECT policy, so every authoring write from the
-- Super Admin page failed with 42501 "new row violates row-level security
-- policy". The draft tables had RLS enabled with no policies at all, making
-- them unreadable and unwritable by anyone.
--
-- Fix: keep reads public on the *_public tables, and grant superadmins full
-- write access on both the public and draft tables. Rerunnable.

-- ─── logic_game_nodes_public ────────────────────────────────────────────────
drop policy if exists logic_game_nodes_public_read_all on logic_game_nodes_public;
create policy logic_game_nodes_public_read_all on logic_game_nodes_public
for select using (true);

drop policy if exists logic_game_nodes_public_superadmin_insert on logic_game_nodes_public;
create policy logic_game_nodes_public_superadmin_insert on logic_game_nodes_public
for insert to authenticated
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists logic_game_nodes_public_superadmin_update on logic_game_nodes_public;
create policy logic_game_nodes_public_superadmin_update on logic_game_nodes_public
for update to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists logic_game_nodes_public_superadmin_delete on logic_game_nodes_public;
create policy logic_game_nodes_public_superadmin_delete on logic_game_nodes_public
for delete to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin');

-- ─── logic_game_questions_public ────────────────────────────────────────────
drop policy if exists logic_game_questions_public_read_all on logic_game_questions_public;
create policy logic_game_questions_public_read_all on logic_game_questions_public
for select using (true);

drop policy if exists logic_game_questions_public_superadmin_insert on logic_game_questions_public;
create policy logic_game_questions_public_superadmin_insert on logic_game_questions_public
for insert to authenticated
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists logic_game_questions_public_superadmin_update on logic_game_questions_public;
create policy logic_game_questions_public_superadmin_update on logic_game_questions_public
for update to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists logic_game_questions_public_superadmin_delete on logic_game_questions_public;
create policy logic_game_questions_public_superadmin_delete on logic_game_questions_public
for delete to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin');

-- ─── Draft tables (superadmin-only, no public read) ─────────────────────────
drop policy if exists logic_game_nodes_draft_superadmin_all on logic_game_nodes_draft;
create policy logic_game_nodes_draft_superadmin_all on logic_game_nodes_draft
for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists logic_game_questions_draft_superadmin_all on logic_game_questions_draft;
create policy logic_game_questions_draft_superadmin_all on logic_game_questions_draft
for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');
