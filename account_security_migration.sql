-- Account-role hardening and consent records for the Egypt launch.
-- Safe to rerun.

alter table profiles add column if not exists birth_date date;
alter table profiles add column if not exists country_code text;
alter table profiles add column if not exists guardian_consent_status text not null default 'not_required';
alter table profiles drop constraint if exists profiles_guardian_consent_status_check;
alter table profiles add constraint profiles_guardian_consent_status_check
  check (guardian_consent_status in ('not_required', 'pending', 'granted', 'revoked'));

create table if not exists guardian_consents (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references profiles(id) on delete cascade,
  guardian_id text references profiles(id) on delete set null,
  guardian_email text not null,
  status text not null default 'pending' check (status in ('pending', 'granted', 'revoked', 'expired')),
  policy_version text not null,
  requested_at timestamptz not null default now(),
  granted_at timestamptz,
  revoked_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  unique (student_id, guardian_email, policy_version)
);

create index if not exists guardian_consents_student_idx on guardian_consents(student_id);
create index if not exists guardian_consents_guardian_idx on guardian_consents(guardian_id);
alter table guardian_consents enable row level security;

create or replace function rls_profile_role_value(p_profile_id text)
returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = p_profile_id; $$;

create or replace function rls_profile_consent_value(p_profile_id text)
returns text language sql stable security definer set search_path = public
as $$ select guardian_consent_status from profiles where id = p_profile_id; $$;

create or replace function rls_profile_birth_date_value(p_profile_id text)
returns date language sql stable security definer set search_path = public
as $$ select birth_date from profiles where id = p_profile_id; $$;

create or replace function rls_profile_country_value(p_profile_id text)
returns text language sql stable security definer set search_path = public
as $$ select country_code from profiles where id = p_profile_id; $$;

-- A browser-created profile can only start as a student or parent. Elevated
-- roles must be assigned by protected server/database administration.
drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert to authenticated
with check (
  auth.uid()::text = id
  and role in ('student', 'parent')
  and guardian_consent_status in ('not_required', 'pending')
);

-- Users may edit their own profile but cannot change their authoritative role.
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated
using (auth.uid()::text = id)
with check (
  auth.uid()::text = id
  and role = rls_profile_role_value(auth.uid()::text)
  and guardian_consent_status = rls_profile_consent_value(auth.uid()::text)
  and birth_date is not distinct from rls_profile_birth_date_value(auth.uid()::text)
  and country_code is not distinct from rls_profile_country_value(auth.uid()::text)
);

drop policy if exists guardian_consents_student_select on guardian_consents;
create policy guardian_consents_student_select on guardian_consents for select to authenticated
using (student_id = auth.uid()::text or guardian_id = auth.uid()::text);

drop policy if exists guardian_consents_student_request on guardian_consents;
create policy guardian_consents_student_request on guardian_consents for insert to authenticated
with check (student_id = auth.uid()::text and status = 'pending' and guardian_id is null);

-- A linked guardian may grant or revoke consent. Direct student updates are not allowed.
drop policy if exists guardian_consents_guardian_update on guardian_consents;
create policy guardian_consents_guardian_update on guardian_consents for update to authenticated
using (guardian_id = auth.uid()::text)
with check (guardian_id = auth.uid()::text and status in ('granted', 'revoked'));

create or replace function guardian_pending_for_me()
returns table(consent_id uuid, student_id text, student_username text, requested_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select gc.id, gc.student_id, coalesce(p.username, ''), gc.requested_at
  from guardian_consents gc
  join profiles me on me.id = auth.uid()::text and me.role = 'parent'
  join profiles p on p.id = gc.student_id
  where gc.status = 'pending' and lower(gc.guardian_email) = lower(me.email);
$$;

create or replace function guardian_decide_consent(p_consent_id uuid, p_grant boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_parent_id text := auth.uid()::text;
  v_student_id text;
  v_existing_parent text;
begin
  select gc.student_id into v_student_id
  from guardian_consents gc
  join profiles me on me.id = v_parent_id and me.role = 'parent'
  where gc.id = p_consent_id
    and gc.status = 'pending'
    and lower(gc.guardian_email) = lower(me.email)
  for update;
  if v_student_id is null then raise exception 'Consent request not found.'; end if;

  select parent_id into v_existing_parent from parent_student_links where student_id = v_student_id;
  if p_grant and v_existing_parent is not null and v_existing_parent <> v_parent_id then
    raise exception 'This student is already linked to another guardian.';
  end if;

  update guardian_consents set
    guardian_id = v_parent_id,
    status = case when p_grant then 'granted' else 'revoked' end,
    granted_at = case when p_grant then now() else null end,
    revoked_at = case when p_grant then null else now() end,
    evidence = evidence || jsonb_build_object('decided_at', now(), 'guardian_id', v_parent_id)
  where id = p_consent_id;

  update profiles set guardian_consent_status = case when p_grant then 'granted' else 'revoked' end
  where id = v_student_id;

  if p_grant then
    insert into parent_student_links(parent_id, student_id)
    values (v_parent_id, v_student_id)
    on conflict (student_id) do nothing;
  else
    delete from parent_student_links where parent_id = v_parent_id and student_id = v_student_id;
  end if;
end;
$$;

revoke all on function guardian_pending_for_me() from public;
revoke all on function guardian_decide_consent(uuid, boolean) from public;
grant execute on function guardian_pending_for_me() to authenticated;
grant execute on function guardian_decide_consent(uuid, boolean) to authenticated;

-- Direct economy-write policies are intentionally left unchanged here. They
-- will be removed only after every legacy game reward path uses the ledger API.
