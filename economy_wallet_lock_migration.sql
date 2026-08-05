-- Final shared-wallet security cutover.
-- Run only after economy_ledger_migration.sql and the matching API/web builds
-- are deployed and verified. New-wallet inserts and wallet reads remain
-- available to authenticated users; direct balance updates do not.

begin;

do $$
begin
  if to_regprocedure('public.economy_bootstrap_wallet(text)') is null
     or to_regprocedure('public.economy_grant_event(text,text,text,text,integer,integer,integer,integer,jsonb)') is null then
    raise exception 'Server-authoritative economy functions are missing; rerun economy_ledger_migration.sql first';
  end if;
end;
$$;

drop policy if exists user_economy_insert_own on user_economy;
drop policy if exists user_economy_update_own on user_economy;

insert into app_schema_migrations(migration_key,details)
values(
  'economy_wallet_lock_v2',
  jsonb_build_object('description','Server-only wallet creation and balance updates')
)
on conflict(migration_key) do update set applied_at=now(),details=excluded.details;

commit;
