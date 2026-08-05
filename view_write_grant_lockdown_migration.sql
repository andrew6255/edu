-- Revoke client write privileges on the read-only projection views.
-- Apply after profile_privacy_migration.sql and
-- program_answer_confidentiality_migration.sql. Safe to rerun.
--
-- Problem: both views are owned by `postgres` and are not security_invoker, so
-- statements against them execute with the owner's rights and bypass RLS on the
-- base tables. Supabase's default privileges grant ALL on new objects in
-- `public` to `anon` and `authenticated`, and the creating migrations only did
-- `revoke all ... from public` (the PUBLIC pseudo-role) — which does not touch
-- those explicit role grants. Both views were therefore auto-updatable by any
-- signed-in user, with base-table RLS bypassed. Verified before this fix: a
-- student could run `update profile_directory set role = 'superadmin'` on their
-- own row and it succeeded, while the same write against `profiles` was
-- correctly rejected by RLS.
--
-- Fix: strip every privilege from the client roles, then grant back SELECT
-- only. Reads are unchanged; the views intentionally stay owner-run so they can
-- project safe columns across rows that base-table RLS hides.

begin;

revoke all on profile_directory from public, anon, authenticated;
grant select on profile_directory to authenticated;

revoke all on public_programs_sanitized from public, anon, authenticated;
grant select on public_programs_sanitized to anon, authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.profile_directory', 'update')
     or has_table_privilege('authenticated', 'public.profile_directory', 'insert')
     or has_table_privilege('authenticated', 'public.profile_directory', 'delete') then
    raise exception 'profile_directory is still writable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.public_programs_sanitized', 'update')
     or has_table_privilege('anon', 'public.public_programs_sanitized', 'update') then
    raise exception 'public_programs_sanitized is still writable by client roles';
  end if;
  if not has_table_privilege('authenticated', 'public.profile_directory', 'select')
     or not has_table_privilege('anon', 'public.public_programs_sanitized', 'select')
     or not has_table_privilege('authenticated', 'public.public_programs_sanitized', 'select') then
    raise exception 'expected SELECT grants are missing after lockdown';
  end if;
end;
$$;

commit;
