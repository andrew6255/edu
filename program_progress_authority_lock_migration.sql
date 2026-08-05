-- Run only after economy_ledger_migration.sql and the updated API/web app are deployed.
-- Non-reward fields remain client-editable for personal-program workflows.
-- Reward-bearing ranked fields are protected because RLS cannot compare OLD
-- and NEW JSON values.

create or replace function guard_program_progress_reward_fields()
returns trigger language plpgsql set search_path=public
as $$
declare v_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
begin
  if tg_op='DELETE' and old.collection<>'program_progress' then return old; end if;
  if tg_op<>'DELETE' and new.collection<>'program_progress' then return new; end if;

  if v_role='service_role' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op='DELETE' then
    raise exception 'Program progress deletion must use a server action';
  end if;

  if tg_op='INSERT' and new.collection='program_progress' and new.data ?| array[
    'rankedTrophies','rankedSolvedQuestionIds','rankedIncorrectQuestionIds','claimedRewardIds'
  ] then
    raise exception 'Ranked program progress is server-managed';
  end if;

  if tg_op='UPDATE' and new.collection='program_progress' and (
    old.data->'rankedTrophies' is distinct from new.data->'rankedTrophies'
    or old.data->'rankedSolvedQuestionIds' is distinct from new.data->'rankedSolvedQuestionIds'
    or old.data->'rankedIncorrectQuestionIds' is distinct from new.data->'rankedIncorrectQuestionIds'
    or old.data->'claimedRewardIds' is distinct from new.data->'claimedRewardIds'
  ) then
    raise exception 'Ranked program progress is server-managed';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_program_progress_reward_fields_trigger on user_docs;
create trigger guard_program_progress_reward_fields_trigger
before insert or update or delete on user_docs
for each row
execute function guard_program_progress_reward_fields();

insert into app_schema_migrations(migration_key,details)
values(
  'program_progress_authority_lock_v1',
  jsonb_build_object('description','Server-managed ranked trophies and roadmap claims')
)
on conflict(migration_key) do update
set applied_at=now(),details=excluded.details;
