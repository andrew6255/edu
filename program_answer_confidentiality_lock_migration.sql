-- Run only after program_answer_confidentiality_migration.sql is installed and
-- the updated web app has been deployed and tested against the sanitized view.

begin;

-- Abort before changing RLS if the safe public replacement is incomplete.
do $$
begin
  if to_regclass('public.public_programs_sanitized') is null then
    raise exception 'public_programs_sanitized is missing; run program_answer_confidentiality_migration.sql first';
  end if;
  if to_regprocedure('public.sanitize_program_annotations(jsonb)') is null
     or to_regprocedure('public.sanitize_program_question_banks(jsonb)') is null then
    raise exception 'Program answer sanitizers are missing or incomplete';
  end if;
  if not has_table_privilege('anon','public.public_programs_sanitized','select')
     or not has_table_privilege('authenticated','public.public_programs_sanitized','select') then
    raise exception 'Student-safe program view SELECT grants are missing';
  end if;
  if not exists(
    select 1 from app_schema_migrations
    where migration_key='program_answer_sanitized_view_v1'
  ) then
    raise exception 'Program answer confidentiality pre-deployment migration is not recorded';
  end if;
end;
$$;

drop policy if exists public_programs_read_all on public_programs;
drop policy if exists public_programs_superadmin_select on public_programs;
create policy public_programs_superadmin_select on public_programs
for select to authenticated
using (exists(
  select 1 from profiles where id=auth.uid()::text and role='superadmin'
));

insert into app_schema_migrations(migration_key,details)
values(
  'program_answer_confidentiality_lock_v1',
  jsonb_build_object('description','Full published answer payload restricted to superadmin and service role')
)
on conflict(migration_key) do update set applied_at=now(),details=excluded.details;

commit;
