-- Run only after profile_privacy_migration.sql and the matching web/API build
-- are deployed. This removes anonymous profile access and replaces the legacy
-- all-authenticated policy with relationship-aware private access.

begin;

do $$
begin
  if to_regclass('public.profile_directory') is null
     or to_regprocedure('public.rls_can_read_private_profile(text)') is null
     or to_regprocedure('public.get_friend_presence(text[])') is null then
    raise exception 'Profile privacy prerequisites are missing; run profile_privacy_migration.sql first';
  end if;
end;
$$;

drop policy if exists profiles_select_anon on profiles;
drop policy if exists profiles_select_own on profiles;
drop policy if exists profiles_select_authorized on profiles;
create policy profiles_select_authorized on profiles for select to authenticated
using (rls_can_read_private_profile(id));

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and roles::text like '%anon%'
  ) then
    raise exception 'Anonymous profile policy still exists';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and policyname<>'profiles_select_authorized' and cmd='SELECT'
  ) then
    raise exception 'An unexpected legacy profile SELECT policy still exists';
  end if;
end;
$$;

commit;
