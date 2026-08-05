-- Server-authoritative shared economy foundation.
-- Apply before deploying the API economy route.

create extension if not exists pgcrypto;

alter table user_economy add column if not exists gems integer not null default 0;

create table if not exists economy_ledger (
  id bigint generated always as identity primary key,
  user_id text not null references profiles(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  source_id text,
  gold_delta integer not null default 0,
  xp_delta integer not null default 0,
  energy_delta integer not null default 0,
  gems_delta integer not null default 0,
  balance_after jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);
alter table economy_ledger add column if not exists streak_delta integer not null default 0;

create index if not exists economy_ledger_user_created_idx
  on economy_ledger(user_id, created_at desc);

create table if not exists app_schema_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

alter table economy_ledger enable row level security;
drop policy if exists economy_ledger_select_own on economy_ledger;
create policy economy_ledger_select_own on economy_ledger for select to authenticated
using (user_id = auth.uid()::text);

-- Create the initial wallet exactly once. Existing wallets are never credited,
-- which lets this endpoint be called safely on every login during rollout.
create or replace function economy_bootstrap_wallet(p_user_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_balance user_economy%rowtype;
  v_inserted boolean:=false;
begin
  if p_user_id is null or length(trim(p_user_id))<3 then
    raise exception 'Invalid economy user';
  end if;

  insert into user_economy(user_id,gold)
  values(p_user_id,200)
  on conflict(user_id) do nothing
  returning * into v_balance;
  v_inserted:=found;

  if not v_inserted then
    select * into v_balance from user_economy where user_id=p_user_id;
  else
    insert into economy_ledger(
      user_id,event_key,event_type,source_id,gold_delta,xp_delta,energy_delta,gems_delta,balance_after,metadata
    ) values(
      p_user_id,'account_bootstrap:v1','account_bootstrap','v1',200,0,0,0,
      jsonb_build_object(
        'gold',v_balance.gold,'xp',v_balance.global_xp,'energy',v_balance.energy,
        'gems',v_balance.gems,'rankedEnergyStreak',v_balance.ranked_energy_streak
      ),
      jsonb_build_object('startingGold',200)
    ) on conflict(user_id,event_key) do nothing;
  end if;

  return jsonb_build_object(
    'applied',v_inserted,
    'balance',jsonb_build_object(
      'gold',v_balance.gold,'xp',v_balance.global_xp,'energy',v_balance.energy,
      'gems',v_balance.gems,'rankedEnergyStreak',v_balance.ranked_energy_streak
    )
  );
end;
$$;
revoke all on function economy_bootstrap_wallet(text) from public,anon,authenticated;
grant execute on function economy_bootstrap_wallet(text) to service_role;

-- Only the trusted server/service role can execute this mutation. The unique
-- event key makes retries safe and prevents duplicate rewards.
create or replace function economy_grant_event(
  p_user_id text,
  p_event_key text,
  p_event_type text,
  p_source_id text,
  p_gold integer,
  p_xp integer,
  p_energy integer,
  p_gems integer,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_balance user_economy%rowtype;
begin
  if p_event_key is null or length(trim(p_event_key)) < 3 then
    raise exception 'Invalid economy event key';
  end if;

  insert into user_economy(user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_balance from user_economy where user_id = p_user_id for update;

  if exists(select 1 from economy_ledger where user_id = p_user_id and event_key = p_event_key) then
    return jsonb_build_object('applied', false, 'balance', jsonb_build_object(
      'gold', v_balance.gold, 'xp', v_balance.global_xp,
      'energy', v_balance.energy, 'gems', v_balance.gems,
      'rankedEnergyStreak', v_balance.ranked_energy_streak
    ));
  end if;

  if v_balance.gold + p_gold < 0
    or v_balance.global_xp + p_xp < 0
    or v_balance.energy + p_energy < 0
    or v_balance.gems + p_gems < 0 then
    raise exception 'Insufficient economy balance';
  end if;

  -- Reserve the idempotency key before changing the balance.
  insert into economy_ledger(
    user_id, event_key, event_type, source_id,
    gold_delta, xp_delta, energy_delta, gems_delta, balance_after, metadata
  ) values (
    p_user_id, p_event_key, p_event_type, p_source_id,
    p_gold, p_xp, p_energy, p_gems, '{}'::jsonb, coalesce(p_metadata, '{}'::jsonb)
  )
  ;

  update user_economy set
    gold = gold + p_gold,
    global_xp = global_xp + p_xp,
    energy = energy + p_energy,
    gems = gems + p_gems,
    updated_at = now()
  where user_id = p_user_id
  returning * into v_balance;

  update economy_ledger set balance_after = jsonb_build_object(
    'gold', v_balance.gold, 'xp', v_balance.global_xp,
    'energy', v_balance.energy, 'gems', v_balance.gems,
    'rankedEnergyStreak', v_balance.ranked_energy_streak
  ) where user_id = p_user_id and event_key = p_event_key;

  return jsonb_build_object('applied', true, 'balance', jsonb_build_object(
    'gold', v_balance.gold, 'xp', v_balance.global_xp,
    'energy', v_balance.energy, 'gems', v_balance.gems,
    'rankedEnergyStreak', v_balance.ranked_energy_streak
  ));
end;
$$;

revoke all on function economy_grant_event(text,text,text,text,integer,integer,integer,integer,jsonb) from public, anon, authenticated;
grant execute on function economy_grant_event(text,text,text,text,integer,integer,integer,integer,jsonb) to service_role;

-- Fixed study policy: one coin and five XP per accepted correct-answer event,
-- plus one Energy for each three-answer streak. Incorrect answers reset the
-- streak. A daily ceiling limits damage until grading is fully server-side.
create or replace function economy_record_study_answer(
  p_user_id text,
  p_event_key text,
  p_source_id text,
  p_correct boolean
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_balance user_economy%rowtype;
  v_streak integer;
  v_energy integer := 0;
  v_rewarded_today integer;
  v_result jsonb;
begin
  insert into user_economy(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_balance from user_economy where user_id = p_user_id for update;

  if exists(select 1 from economy_ledger where user_id = p_user_id and event_key = p_event_key) then
    return jsonb_build_object('applied', false, 'balance', jsonb_build_object(
      'gold', v_balance.gold, 'xp', v_balance.global_xp, 'energy', v_balance.energy,
      'gems', v_balance.gems, 'rankedEnergyStreak', v_balance.ranked_energy_streak
    ));
  end if;

  if not p_correct then
    update user_economy set ranked_energy_streak = 0, updated_at = now() where user_id = p_user_id;
    v_result := economy_grant_event(p_user_id, p_event_key, 'study_incorrect', p_source_id, 0, 0, 0, 0, jsonb_build_object('correct', false));
    return jsonb_set(v_result, '{balance,rankedEnergyStreak}', '0'::jsonb, true);
  end if;

  select count(*) into v_rewarded_today from economy_ledger
  where user_id = p_user_id and event_type = 'study_correct' and created_at >= date_trunc('day', now());
  if v_rewarded_today >= 200 then
    return economy_grant_event(p_user_id, p_event_key, 'study_correct_capped', p_source_id, 0, 0, 0, 0, jsonb_build_object('dailyCap', 200));
  end if;

  v_streak := v_balance.ranked_energy_streak + 1;
  if v_streak >= 3 then v_energy := 1; v_streak := 0; end if;
  v_result := economy_grant_event(p_user_id, p_event_key, 'study_correct', p_source_id, 1, 5, v_energy, 0, jsonb_build_object('correct', true));
  update user_economy set ranked_energy_streak = v_streak, updated_at = now() where user_id = p_user_id;
  update economy_ledger set balance_after = jsonb_set(balance_after, '{rankedEnergyStreak}', to_jsonb(v_streak), true)
  where user_id = p_user_id and event_key = p_event_key;
  return jsonb_set(v_result, '{balance,rankedEnergyStreak}', to_jsonb(v_streak), true);
end;
$$;

revoke all on function economy_record_study_answer(text,text,text,boolean) from public, anon, authenticated;
grant execute on function economy_record_study_answer(text,text,text,boolean) to service_role;

create or replace function economy_record_ranked_program_answer(
  p_user_id text,
  p_program_id text,
  p_question_id text,
  p_correct boolean
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_program public_programs%rowtype;
  v_progress user_docs%rowtype;
  v_question_exists boolean:=false;
  v_trophies integer:=0;
  v_floor integer:=0;
  v_magnitude integer;
  v_correct_ids jsonb:='[]'::jsonb;
  v_incorrect_ids jsonb:='[]'::jsonb;
  v_was_correct boolean:=false;
  v_was_incorrect boolean:=false;
  v_source_id text;
  v_event_key text;
  v_economy jsonb;
begin
  if length(trim(p_program_id))<1 or length(p_program_id)>200
     or length(trim(p_question_id))<3 or length(p_question_id)>300 then
    raise exception 'Invalid ranked program answer';
  end if;
  select * into v_program from public_programs
  where id=p_program_id and deleted_at is null;
  if not found then raise exception 'Published program not found'; end if;

  select exists(
    select 1
    from jsonb_each(case when jsonb_typeof(v_program.question_banks_by_chapter)='object' then v_program.question_banks_by_chapter else '{}'::jsonb end) chapter
    cross join lateral jsonb_array_elements(coalesce(chapter.value->'nodes','[]'::jsonb)) node
    cross join lateral jsonb_array_elements(coalesce(node.value->'questions','[]'::jsonb)) question
    where p_question_id=(node.value->>'node_id')||'::'||(question.value->>'question_id')
       or exists(
         select 1 from jsonb_array_elements(coalesce(question.value->'parts','[]'::jsonb)) part
         where p_question_id=(node.value->>'node_id')||'::'||(question.value->>'question_id')||'::'||(part.value->>'part_id')
       )
  ) into v_question_exists;
  if not v_question_exists then raise exception 'Question is not part of this published program'; end if;

  insert into user_docs(user_id,collection,doc_id,data)
  values(p_user_id,'program_progress',p_program_id,jsonb_build_object(
    'programId',p_program_id,'completedUnitIds','[]'::jsonb,'solvedQuestionIds','[]'::jsonb,
    'rankedTrophies',0,'rankedSolvedQuestionIds','[]'::jsonb,
    'rankedIncorrectQuestionIds','[]'::jsonb,'claimedRewardIds','[]'::jsonb,
    'updatedAt',now()
  )) on conflict(user_id,collection,doc_id) do nothing;
  select * into v_progress from user_docs
  where user_id=p_user_id and collection='program_progress' and doc_id=p_program_id for update;

  if coalesce(v_progress.data->>'rankedTrophies','')~'^\d+$' then v_trophies:=(v_progress.data->>'rankedTrophies')::integer; end if;
  if jsonb_typeof(v_progress.data->'rankedSolvedQuestionIds')='array' then v_correct_ids:=v_progress.data->'rankedSolvedQuestionIds'; end if;
  if jsonb_typeof(v_progress.data->'rankedIncorrectQuestionIds')='array' then v_incorrect_ids:=v_progress.data->'rankedIncorrectQuestionIds'; end if;
  v_was_correct:=v_correct_ids ? p_question_id;
  v_was_incorrect:=v_incorrect_ids ? p_question_id;
  v_magnitude:=14+abs(hashtext(p_user_id||':'||p_program_id||':'||p_question_id)::bigint)%3;

  if p_correct and not v_was_correct then
    v_trophies:=v_trophies+v_magnitude;
    v_correct_ids:=v_correct_ids||jsonb_build_array(p_question_id);
    if v_was_incorrect then
      select coalesce(jsonb_agg(value),'[]'::jsonb) into v_incorrect_ids
      from jsonb_array_elements(v_incorrect_ids) where value<>to_jsonb(p_question_id);
    end if;
  elsif not p_correct and not v_was_correct and not v_was_incorrect then
    v_floor:=(greatest(v_trophies,0)/100)*100;
    v_trophies:=greatest(v_floor,v_trophies-v_magnitude,0);
    v_incorrect_ids:=v_incorrect_ids||jsonb_build_array(p_question_id);
  end if;

  update user_docs set data=data||jsonb_build_object(
    'rankedTrophies',v_trophies,'rankedSolvedQuestionIds',v_correct_ids,
    'rankedIncorrectQuestionIds',v_incorrect_ids,'updatedAt',now()
  ),updated_at=now()
  where user_id=p_user_id and collection='program_progress' and doc_id=p_program_id;

  v_source_id:='program:'||p_program_id||':ranked:'||p_question_id;
  v_event_key:='study:'||encode(digest(v_source_id||':'||case when p_correct then 'correct' else 'incorrect' end,'sha256'),'hex');
  v_economy:=economy_record_study_answer(p_user_id,v_event_key,v_source_id,p_correct);
  return jsonb_build_object('trophies',v_trophies,'correctIds',v_correct_ids,'incorrectIds',v_incorrect_ids,'economy',v_economy);
end;
$$;
revoke all on function economy_record_ranked_program_answer(text,text,text,boolean) from public,anon,authenticated;
grant execute on function economy_record_ranked_program_answer(text,text,text,boolean) to service_role;

create or replace function economy_record_solo_program_answer(
  p_user_id text,
  p_program_id text,
  p_question_id text,
  p_correct boolean
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_program public_programs%rowtype;
  v_question_exists boolean:=false;
  v_progress user_docs%rowtype;
  v_solved jsonb:='[]'::jsonb;
  v_source_id text;
  v_event_key text;
begin
  if length(trim(p_program_id))<1 or length(p_program_id)>200
     or length(trim(p_question_id))<3 or length(p_question_id)>300 then
    raise exception 'Invalid solo program answer';
  end if;
  select * into v_program from public_programs where id=p_program_id and deleted_at is null;
  if not found then raise exception 'Published program not found'; end if;
  select exists(
    select 1
    from jsonb_each(case when jsonb_typeof(v_program.question_banks_by_chapter)='object' then v_program.question_banks_by_chapter else '{}'::jsonb end) chapter
    cross join lateral jsonb_array_elements(coalesce(chapter.value->'nodes','[]'::jsonb)) node
    cross join lateral jsonb_array_elements(coalesce(node.value->'questions','[]'::jsonb)) question
    where p_question_id=(node.value->>'node_id')||'::'||(question.value->>'question_id')
       or exists(
         select 1 from jsonb_array_elements(coalesce(question.value->'parts','[]'::jsonb)) part
         where p_question_id=(node.value->>'node_id')||'::'||(question.value->>'question_id')||'::'||(part.value->>'part_id')
       )
  ) into v_question_exists;
  if not v_question_exists then raise exception 'Question is not part of this published program'; end if;

  if p_correct then
    insert into user_docs(user_id,collection,doc_id,data)
    values(p_user_id,'program_progress',p_program_id,jsonb_build_object(
      'programId',p_program_id,'completedUnitIds','[]'::jsonb,
      'solvedQuestionIds',jsonb_build_array(p_question_id),'updatedAt',now()
    )) on conflict(user_id,collection,doc_id) do nothing;
    select * into v_progress from user_docs
    where user_id=p_user_id and collection='program_progress' and doc_id=p_program_id for update;
    if jsonb_typeof(v_progress.data->'solvedQuestionIds')='array' then v_solved:=v_progress.data->'solvedQuestionIds'; end if;
    if not (v_solved ? p_question_id) then
      v_solved:=v_solved||jsonb_build_array(p_question_id);
      update user_docs set data=data||jsonb_build_object('solvedQuestionIds',v_solved,'updatedAt',now()),updated_at=now()
      where user_id=p_user_id and collection='program_progress' and doc_id=p_program_id;
    end if;
  end if;

  v_source_id:='program:'||p_program_id||':solo:'||p_question_id;
  v_event_key:='study:'||encode(digest(v_source_id||':'||case when p_correct then 'correct' else 'incorrect' end,'sha256'),'hex');
  return economy_record_study_answer(p_user_id,v_event_key,v_source_id,p_correct);
end;
$$;
revoke all on function economy_record_solo_program_answer(text,text,text,boolean) from public,anon,authenticated;
grant execute on function economy_record_solo_program_answer(text,text,text,boolean) to service_role;

-- Ranked roadmap rewards are validated, claimed, and credited in one database
-- transaction. This prevents double claims and eliminates the former gap where
-- the browser updated progress and balance separately.
create or replace function economy_claim_roadmap_reward(
  p_user_id text,
  p_program_id text,
  p_milestone integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_progress user_docs%rowtype;
  v_trophies integer := 0;
  v_gold integer;
  v_reward_id text;
  v_result jsonb;
begin
  if p_program_id is null or length(trim(p_program_id)) < 1 or length(p_program_id) > 200 then
    raise exception 'Invalid program';
  end if;
  if p_milestone <= 0 or p_milestone % 100 <> 0 then
    raise exception 'Invalid roadmap milestone';
  end if;

  select * into v_progress from user_docs
  where user_id = p_user_id and collection = 'program_progress' and doc_id = p_program_id
  for update;
  if not found then raise exception 'Program progress not found'; end if;

  if coalesce(v_progress.data->>'rankedTrophies', '') ~ '^\d+$' then
    v_trophies := (v_progress.data->>'rankedTrophies')::integer;
  end if;
  if v_trophies < p_milestone then raise exception 'Roadmap milestone not reached'; end if;

  v_reward_id := 'reward_' || p_milestone::text;
  if coalesce(v_progress.data->'claimedRewardIds', '[]'::jsonb) ? v_reward_id then
    raise exception 'Roadmap reward already claimed';
  end if;

  v_gold := case
    when p_milestone >= 9000 then 600
    when p_milestone >= 5000 then 300
    when p_milestone >= 2000 then 150
    else 75
  end;

  v_result := economy_grant_event(
    p_user_id,
    'roadmap:' || p_program_id || ':' || p_milestone::text,
    'roadmap_reward',
    p_program_id || ':' || p_milestone::text,
    v_gold, 0, 0, 0,
    jsonb_build_object('programId', p_program_id, 'milestone', p_milestone)
  );

  update user_docs set
    data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{claimedRewardIds}',
      coalesce(data->'claimedRewardIds', '[]'::jsonb) || jsonb_build_array(v_reward_id),
      true
    ),
    updated_at = now()
  where user_id = p_user_id and collection = 'program_progress' and doc_id = p_program_id;

  return v_result || jsonb_build_object('reward', jsonb_build_object('gold', v_gold));
end;
$$;

revoke all on function economy_claim_roadmap_reward(text,text,integer) from public, anon, authenticated;
grant execute on function economy_claim_roadmap_reward(text,text,integer) to service_role;

create or replace function economy_claim_chrono_task(
  p_user_id text,
  p_task_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_state user_docs%rowtype;
  v_goal integer;
  v_progress integer := 0;
  v_gold integer := 0;
  v_energy integer := 0;
  v_gems integer := 0;
  v_period_key text;
  v_result jsonb;
  v_claimed_at bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  select * into v_state from user_docs
  where user_id = p_user_id and collection = 'chrono_tasks' and doc_id = 'state'
  for update;
  if not found then raise exception 'Chrono task state not found'; end if;

  case p_task_id
    when 'd_spin_3' then v_goal := 3; v_gold := 500;
    when 'd_study_10' then v_goal := 10; v_energy := 2;
    when 'd_buy_1' then v_goal := 1; v_gold := 1000;
    when 'd_upgrade_1' then v_goal := 1; v_gold := 2000;
    when 'd_copies_5' then v_goal := 5; v_gold := 1500;
    when 'w_spin_20' then v_goal := 20; v_gold := 10000; v_gems := 2;
    when 'w_study_100' then v_goal := 100; v_energy := 20; v_gems := 5;
    when 'w_auction_5' then v_goal := 5; v_gold := 15000;
    when 'w_upgrade_5' then v_goal := 5; v_gold := 20000; v_gems := 3;
    when 'w_buy_10' then v_goal := 10; v_gold := 25000;
    when 'l_spin_100' then v_goal := 100; v_gems := 20;
    when 'l_upgrade_30' then v_goal := 30; v_gems := 50;
    when 'l_study_1000' then v_goal := 1000; v_gold := 100000; v_gems := 100;
    when 'l_auction_50' then v_goal := 50; v_gold := 50000; v_gems := 30;
    when 'l_copies_500' then v_goal := 500; v_gems := 40;
    else raise exception 'Unknown Chrono task';
  end case;

  if coalesce(v_state.data->'progress'->>p_task_id, '') ~ '^\d+$' then
    v_progress := (v_state.data->'progress'->>p_task_id)::integer;
  end if;
  if v_progress < v_goal then raise exception 'Chrono task not completed'; end if;
  if coalesce(v_state.data->'claimed', '{}'::jsonb) ? p_task_id then
    raise exception 'Chrono task already claimed';
  end if;

  v_period_key := case
    when p_task_id like 'd\_%' escape '\' then coalesce(v_state.data->>'dailyKey', to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
    when p_task_id like 'w\_%' escape '\' then coalesce(v_state.data->>'weeklyKey', to_char(now() at time zone 'utc', 'IYYY-"W"IW'))
    else 'lifetime'
  end;

  v_result := economy_grant_event(
    p_user_id,
    'chrono_task:' || p_task_id || ':' || v_period_key,
    'chrono_task_reward',
    p_task_id,
    v_gold, 0, v_energy, v_gems,
    jsonb_build_object('taskId', p_task_id, 'periodKey', v_period_key)
  );

  update user_docs set
    data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{claimed}',
      coalesce(data->'claimed', '{}'::jsonb) || jsonb_build_object(p_task_id, v_claimed_at),
      true
    ),
    updated_at = now()
  where user_id = p_user_id and collection = 'chrono_tasks' and doc_id = 'state';

  return v_result || jsonb_build_object('reward', jsonb_build_object(
    'coins', v_gold, 'energy', v_energy, 'gems', v_gems
  ));
end;
$$;

revoke all on function economy_claim_chrono_task(text,text) from public, anon, authenticated;
grant execute on function economy_claim_chrono_task(text,text) to service_role;

create or replace function economy_purchase_card_upgrade(
  p_user_id text,
  p_card_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_inventory user_docs%rowtype;
  v_card jsonb;
  v_level integer;
  v_copies integer;
  v_next_level integer;
  v_needed integer;
  v_cost integer;
  v_result jsonb;
begin
  if p_card_id !~ '^b(100|[2-9]00|[12][0-9]00|3000)_(geo|foo|ent|his)_[1-3]$' then
    raise exception 'Invalid Chrono card';
  end if;
  select * into v_inventory from user_docs
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global'
  for update;
  if not found then raise exception 'Chrono inventory not found'; end if;

  v_card := v_inventory.data->'cards'->p_card_id;
  if v_card is null then raise exception 'Card not owned'; end if;
  v_level := case when coalesce(v_card->>'level', '') ~ '^\d+$' then (v_card->>'level')::integer else 0 end;
  v_copies := case when coalesce(v_card->>'copies', '') ~ '^\d+$' then (v_card->>'copies')::integer else 0 end;
  if v_level < 1 then raise exception 'Card not owned'; end if;
  if v_level >= 4 then raise exception 'Card already at maximum level'; end if;

  v_next_level := v_level + 1;
  v_needed := case v_next_level when 2 then 5 when 3 then 20 when 4 then 50 end;
  v_cost := case v_next_level when 2 then 1000 when 3 then 10000 when 4 then 50000 end;
  if v_copies < v_needed then raise exception 'Not enough card copies'; end if;

  v_result := economy_grant_event(
    p_user_id,
    'chrono_card_upgrade:' || p_card_id || ':' || v_next_level::text,
    'chrono_card_upgrade',
    p_card_id,
    -v_cost, 0, 0, 0,
    jsonb_build_object('cardId', p_card_id, 'level', v_next_level, 'cost', v_cost)
  );

  update user_docs set
    data = jsonb_set(data, array['cards', p_card_id, 'level'], to_jsonb(v_next_level), true),
    updated_at = now()
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';

  return v_result || jsonb_build_object(
    'card', jsonb_build_object('copies', v_copies, 'level', v_next_level),
    'cost', v_cost
  );
end;
$$;

revoke all on function economy_purchase_card_upgrade(text,text) from public, anon, authenticated;
grant execute on function economy_purchase_card_upgrade(text,text) to service_role;

create or replace function economy_purchase_chrono_token(
  p_user_id text,
  p_token_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_inventory user_docs%rowtype;
  v_cost integer;
  v_tokens jsonb;
  v_result jsonb;
begin
  v_cost := case p_token_id
    when 'gold_token' then 5000
    when 'diamond_token' then 15000
    when 'fire_token' then 10000
    when 'crown_token' then 25000
    else null
  end;
  if v_cost is null then raise exception 'Unknown Chrono token'; end if;

  select * into v_inventory from user_docs
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global'
  for update;
  if not found then raise exception 'Chrono inventory not found'; end if;
  v_tokens := coalesce(v_inventory.data->'ownedTokens', '["default"]'::jsonb);
  if v_tokens ? p_token_id then raise exception 'Chrono token already owned'; end if;

  v_result := economy_grant_event(
    p_user_id,
    'chrono_token_purchase:' || p_token_id,
    'chrono_token_purchase',
    p_token_id,
    -v_cost, 0, 0, 0,
    jsonb_build_object('tokenId', p_token_id, 'cost', v_cost)
  );

  update user_docs set
    data = jsonb_set(data, '{ownedTokens}', v_tokens || jsonb_build_array(p_token_id), true),
    updated_at = now()
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';

  return v_result || jsonb_build_object('tokenId', p_token_id, 'cost', v_cost);
end;
$$;

revoke all on function economy_purchase_chrono_token(text,text) from public, anon, authenticated;
grant execute on function economy_purchase_chrono_token(text,text) to service_role;

create or replace function economy_spin_chrono_wheel(
  p_user_id text,
  p_spin_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_inventory user_docs%rowtype;
  v_state jsonb;
  v_existing economy_ledger%rowtype;
  v_balance user_economy%rowtype;
  v_roll integer;
  v_segment text;
  v_gold integer := 0;
  v_board integer := 100;
  v_board_tier integer := 1;
  v_card_id text;
  v_card jsonb;
  v_transport_id text;
  v_result_meta jsonb;
  v_result jsonb;
  v_count integer;
  v_transport_ids text[];
begin
  if p_spin_id is null or p_spin_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Invalid wheel spin identifier';
  end if;

  select * into v_existing from economy_ledger
  where user_id = p_user_id and event_key = 'chrono_wheel:' || p_spin_id;
  if found then
    select * into v_balance from user_economy where user_id = p_user_id;
    return jsonb_build_object(
      'applied', false,
      'balance', jsonb_build_object(
        'gold', v_balance.gold, 'xp', v_balance.global_xp, 'energy', v_balance.energy,
        'gems', v_balance.gems, 'rankedEnergyStreak', v_balance.ranked_energy_streak
      ),
      'result', v_existing.metadata->'result'
    );
  end if;

  select * into v_inventory from user_docs
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global'
  for update;
  if not found then raise exception 'Chrono inventory not found'; end if;

  select data into v_state from user_docs
  where user_id = p_user_id and collection = 'chrono_empires' and doc_id = 'global';
  if coalesce(v_state->>'currentBoard', '') ~ '^\d+$' then
    v_board := greatest(100, least(3000, (v_state->>'currentBoard')::integer));
  end if;
  v_board_tier := greatest(1, least(30, floor(v_board / 100.0)::integer));

  v_roll := floor(random() * 100)::integer + 1;
  v_segment := case
    when v_roll <= 25 then 'w_1k'
    when v_roll <= 45 then 'w_5k'
    when v_roll <= 60 then 'w_10k'
    when v_roll <= 70 then 'w_25k'
    when v_roll <= 75 then 'w_50k'
    when v_roll <= 77 then 'w_100k'
    when v_roll <= 87 then 'w_cat'
    when v_roll <= 92 then 'w_trans'
    when v_roll <= 96 then 'w_defend'
    else 'w_attack'
  end;
  v_gold := case v_segment
    when 'w_1k' then 1000 when 'w_5k' then 5000 when 'w_10k' then 10000
    when 'w_25k' then 25000 when 'w_50k' then 50000 when 'w_100k' then 100000
    else 0
  end;

  if v_segment = 'w_cat' then
    v_card_id := 'b' || ((floor(random() * v_board_tier)::integer + 1) * 100)::text
      || '_' || (array['geo','foo','ent','his'])[floor(random() * 4)::integer + 1]
      || '_' || (floor(random() * 3)::integer + 1)::text;
    v_card := v_inventory.data->'cards'->v_card_id;
    if v_card is null then
      v_card := jsonb_build_object('copies', 1, 'level', 1);
    else
      v_count := case when coalesce(v_card->>'copies', '') ~ '^\d+$' then (v_card->>'copies')::integer else 0 end;
      v_card := jsonb_set(v_card, '{copies}', to_jsonb(v_count + 1), true);
    end if;
    v_inventory.data := jsonb_set(v_inventory.data, array['cards', v_card_id], v_card, true);
  elsif v_segment = 'w_trans' then
    v_transport_ids := array['tr_microbus','tr_toktok','tr_felucca','tr_hantour','tr_mashy'];
    if v_board >= 1000 then v_transport_ids := v_transport_ids || array['tr_swvl','tr_metro','tr_taxi','tr_careem']; end if;
    if v_board >= 2000 then v_transport_ids := v_transport_ids || array['tr_helicopter','tr_yacht','tr_monorail','tr_uberblack']; end if;
    v_transport_id := v_transport_ids[floor(random() * array_length(v_transport_ids, 1))::integer + 1];
    v_count := case
      when coalesce(v_inventory.data->'transportCards'->>v_transport_id, '') ~ '^\d+$'
      then (v_inventory.data->'transportCards'->>v_transport_id)::integer else 0 end;
    v_inventory.data := jsonb_set(v_inventory.data, array['transportCards', v_transport_id], to_jsonb(v_count + 1), true);
  elsif v_segment = 'w_defend' then
    v_count := case when coalesce(v_inventory.data->>'defendCards', '') ~ '^\d+$' then (v_inventory.data->>'defendCards')::integer else 0 end;
    v_inventory.data := jsonb_set(v_inventory.data, '{defendCards}', to_jsonb(least(3, v_count + 1)), true);
  elsif v_segment = 'w_attack' then
    v_count := case when coalesce(v_inventory.data->>'attackCards', '') ~ '^\d+$' then (v_inventory.data->>'attackCards')::integer else 0 end;
    v_inventory.data := jsonb_set(v_inventory.data, '{attackCards}', to_jsonb(least(3, v_count + 1)), true);
  end if;

  v_result_meta := jsonb_strip_nulls(jsonb_build_object(
    'segmentId', v_segment,
    'cardId', v_card_id,
    'transportId', v_transport_id
  ));
  v_result := economy_grant_event(
    p_user_id,
    'chrono_wheel:' || p_spin_id,
    'chrono_wheel_spin',
    p_spin_id,
    v_gold, 0, -1, 0,
    jsonb_build_object('result', v_result_meta)
  );

  if v_segment in ('w_cat', 'w_trans', 'w_defend', 'w_attack') then
    update user_docs set data = v_inventory.data, updated_at = now()
    where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';
  end if;

  return v_result || jsonb_build_object('result', v_result_meta);
end;
$$;

revoke all on function economy_spin_chrono_wheel(text,text) from public, anon, authenticated;
grant execute on function economy_spin_chrono_wheel(text,text) to service_role;

create or replace function economy_purchase_chrono_pack(
  p_user_id text,
  p_pack_id text,
  p_purchase_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_inventory user_docs%rowtype;
  v_state jsonb;
  v_existing economy_ledger%rowtype;
  v_balance user_economy%rowtype;
  v_cost integer;
  v_card_count integer;
  v_board integer := 100;
  v_board_tier integer := 1;
  v_card_id text;
  v_card jsonb;
  v_copies integer;
  v_awarded jsonb := '[]'::jsonb;
  v_transport_id text;
  v_transport_ids text[];
  v_result_meta jsonb;
  v_result jsonb;
  i integer;
begin
  if p_purchase_id is null or p_purchase_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Invalid pack purchase identifier';
  end if;
  case p_pack_id
    when 'pack_basic' then v_cost := 500; v_card_count := 3;
    when 'pack_premium' then v_cost := 2000; v_card_count := 5;
    when 'pack_elite' then v_cost := 8000; v_card_count := 10;
    else raise exception 'Unknown Chrono card pack';
  end case;

  select * into v_existing from economy_ledger
  where user_id = p_user_id and event_key = 'chrono_pack:' || p_purchase_id;
  if found then
    select * into v_balance from user_economy where user_id = p_user_id;
    return jsonb_build_object(
      'applied', false,
      'balance', jsonb_build_object(
        'gold', v_balance.gold, 'xp', v_balance.global_xp, 'energy', v_balance.energy,
        'gems', v_balance.gems, 'rankedEnergyStreak', v_balance.ranked_energy_streak
      ),
      'result', v_existing.metadata->'result'
    );
  end if;

  select * into v_inventory from user_docs
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global'
  for update;
  if not found then raise exception 'Chrono inventory not found'; end if;
  v_inventory.data := jsonb_set(v_inventory.data, '{cards}', coalesce(v_inventory.data->'cards', '{}'::jsonb), true);
  v_inventory.data := jsonb_set(v_inventory.data, '{transportCards}', coalesce(v_inventory.data->'transportCards', '{}'::jsonb), true);

  select data into v_state from user_docs
  where user_id = p_user_id and collection = 'chrono_empires' and doc_id = 'global';
  if coalesce(v_state->>'currentBoard', '') ~ '^\d+$' then
    v_board := greatest(100, least(3000, (v_state->>'currentBoard')::integer));
  end if;
  v_board_tier := greatest(1, least(30, floor(v_board / 100.0)::integer));

  for i in 1..v_card_count loop
    v_card_id := 'b' || ((floor(random() * v_board_tier)::integer + 1) * 100)::text
      || '_' || (array['geo','foo','ent','his'])[floor(random() * 4)::integer + 1]
      || '_' || (floor(random() * 3)::integer + 1)::text;
    v_card := v_inventory.data->'cards'->v_card_id;
    if v_card is null then
      v_card := jsonb_build_object('copies', 1, 'level', 1);
    else
      v_copies := case when coalesce(v_card->>'copies', '') ~ '^\d+$' then (v_card->>'copies')::integer else 0 end;
      v_card := jsonb_set(v_card, '{copies}', to_jsonb(v_copies + 1), true);
    end if;
    v_inventory.data := jsonb_set(v_inventory.data, array['cards', v_card_id], v_card, true);
    v_awarded := v_awarded || jsonb_build_array(v_card_id);
  end loop;

  if p_pack_id = 'pack_elite' then
    v_transport_ids := array['tr_microbus','tr_toktok','tr_felucca','tr_hantour','tr_mashy'];
    if v_board >= 1000 then v_transport_ids := v_transport_ids || array['tr_swvl','tr_metro','tr_taxi','tr_careem']; end if;
    if v_board >= 2000 then v_transport_ids := v_transport_ids || array['tr_helicopter','tr_yacht','tr_monorail','tr_uberblack']; end if;
    v_transport_id := v_transport_ids[floor(random() * array_length(v_transport_ids, 1))::integer + 1];
    v_copies := case
      when coalesce(v_inventory.data->'transportCards'->>v_transport_id, '') ~ '^\d+$'
      then (v_inventory.data->'transportCards'->>v_transport_id)::integer else 0 end;
    v_inventory.data := jsonb_set(v_inventory.data, array['transportCards', v_transport_id], to_jsonb(v_copies + 1), true);
  end if;

  v_result_meta := jsonb_strip_nulls(jsonb_build_object(
    'packId', p_pack_id, 'cardIds', v_awarded, 'transportId', v_transport_id
  ));
  v_result := economy_grant_event(
    p_user_id,
    'chrono_pack:' || p_purchase_id,
    'chrono_pack_purchase',
    p_pack_id,
    -v_cost, 0, 0, 0,
    jsonb_build_object('result', v_result_meta)
  );
  update user_docs set data = v_inventory.data, updated_at = now()
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';

  return v_result || jsonb_build_object('result', v_result_meta);
end;
$$;

revoke all on function economy_purchase_chrono_pack(text,text,text) from public, anon, authenticated;
grant execute on function economy_purchase_chrono_pack(text,text,text) to service_role;

create or replace function economy_send_chrono_energy_gift(
  p_from_user_id text,
  p_to_user_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_from_state jsonb;
  v_to_state jsonb;
  v_gifts user_docs%rowtype;
  v_sent jsonb;
  v_day text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_result jsonb;
begin
  if p_from_user_id = p_to_user_id then raise exception 'Cannot gift yourself'; end if;
  select user_state into v_from_state from profiles where id = p_from_user_id;
  select user_state into v_to_state from profiles where id = p_to_user_id;
  if v_from_state is null or v_to_state is null then raise exception 'Friend not found'; end if;
  if not (coalesce(v_from_state->'friends', '[]'::jsonb) ? p_to_user_id)
    or not (coalesce(v_to_state->'friends', '[]'::jsonb) ? p_from_user_id) then
    raise exception 'Users are not mutual friends';
  end if;

  insert into user_docs(user_id, collection, doc_id, data)
  values (p_from_user_id, 'chrono_friend_gifts', 'state', jsonb_build_object('sent', '{}'::jsonb, 'updatedAt', now()))
  on conflict (user_id, collection, doc_id) do nothing;
  select * into v_gifts from user_docs
  where user_id = p_from_user_id and collection = 'chrono_friend_gifts' and doc_id = 'state'
  for update;
  v_sent := coalesce(v_gifts.data->'sent', '{}'::jsonb);
  if v_sent->>p_to_user_id = v_day then raise exception 'Energy gift already sent today'; end if;

  v_result := economy_grant_event(
    p_to_user_id,
    'chrono_friend_energy:' || p_from_user_id || ':' || v_day,
    'chrono_friend_energy_gift',
    p_from_user_id,
    0, 0, 1, 0,
    jsonb_build_object('fromUserId', p_from_user_id, 'day', v_day)
  );
  update user_docs set
    data = jsonb_set(data, '{sent}', v_sent || jsonb_build_object(p_to_user_id, v_day), true),
    updated_at = now()
  where user_id = p_from_user_id and collection = 'chrono_friend_gifts' and doc_id = 'state';
  return v_result;
end;
$$;

revoke all on function economy_send_chrono_energy_gift(text,text) from public, anon, authenticated;
grant execute on function economy_send_chrono_energy_gift(text,text) to service_role;

create or replace function economy_claim_idle_vault(p_user_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_vault user_docs%rowtype;
  v_coins integer;
  v_progress integer;
  v_goal integer;
  v_event_key text;
  v_now text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_result jsonb;
begin
  select * into v_vault from user_docs
  where user_id = p_user_id and collection = 'chrono_idle_vault' and doc_id = 'state'
  for update;
  if not found then raise exception 'Idle vault not found'; end if;
  v_coins := case when coalesce(v_vault.data->>'accruedCoins', '') ~ '^\d+$' then (v_vault.data->>'accruedCoins')::integer else 0 end;
  v_progress := case when coalesce(v_vault.data->>'warmupProgress', '') ~ '^\d+$' then (v_vault.data->>'warmupProgress')::integer else 0 end;
  v_goal := case when coalesce(v_vault.data->>'warmupGoal', '') ~ '^\d+$' then greatest(1, (v_vault.data->>'warmupGoal')::integer) else 3 end;
  if v_coins <= 0 then raise exception 'No idle coins ready'; end if;
  if v_progress < v_goal then raise exception 'Idle vault study warmup is incomplete'; end if;

  v_event_key := 'chrono_idle_vault:' || md5(coalesce(v_vault.data->>'lastCalculatedAt', '') || ':' || v_coins::text);
  v_result := economy_grant_event(
    p_user_id, v_event_key, 'chrono_idle_vault_claim', 'chrono_idle_vault/state',
    v_coins, 0, 0, 0, jsonb_build_object('coins', v_coins)
  );
  update user_docs set data = data || jsonb_build_object(
    'accruedCoins', 0, 'warmupProgress', 0,
    'lastCalculatedAt', v_now, 'lastClaimedAt', v_now, 'updatedAt', v_now
  ), updated_at = now()
  where user_id = p_user_id and collection = 'chrono_idle_vault' and doc_id = 'state';
  return v_result || jsonb_build_object('coins', v_coins);
end;
$$;

revoke all on function economy_claim_idle_vault(text) from public, anon, authenticated;
grant execute on function economy_claim_idle_vault(text) to service_role;

create or replace function economy_claim_chrono_reward_chest(p_user_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_chest user_docs%rowtype;
  v_inventory user_docs%rowtype;
  v_tasks jsonb;
  v_game_state jsonb;
  v_last_claim timestamptz;
  v_study_progress integer := 0;
  v_board integer := 100;
  v_tier integer := 1;
  v_gold integer;
  v_gems integer;
  v_energy integer;
  v_card_id text;
  v_card jsonb;
  v_copies integer;
  v_now text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_reward jsonb;
  v_result jsonb;
begin
  insert into user_docs(user_id, collection, doc_id, data)
  values (p_user_id, 'chrono_reward_chest', 'state', jsonb_build_object('updatedAt', v_now))
  on conflict (user_id, collection, doc_id) do nothing;
  select * into v_chest from user_docs
  where user_id = p_user_id and collection = 'chrono_reward_chest' and doc_id = 'state'
  for update;
  if coalesce(v_chest.data->>'lastClaimedAt', '') <> '' then
    begin v_last_claim := (v_chest.data->>'lastClaimedAt')::timestamptz; exception when others then v_last_claim := null; end;
  end if;
  if v_last_claim is not null and now() < v_last_claim + interval '24 hours' then
    raise exception 'Reward chest is still cooling down';
  end if;

  select data into v_tasks from user_docs
  where user_id = p_user_id and collection = 'chrono_tasks' and doc_id = 'state';
  v_study_progress :=
    case when coalesce(v_tasks->'progress'->>'d_study_10', '') ~ '^\d+$' then (v_tasks->'progress'->>'d_study_10')::integer else 0 end +
    case when coalesce(v_tasks->'progress'->>'w_study_100', '') ~ '^\d+$' then (v_tasks->'progress'->>'w_study_100')::integer else 0 end +
    case when coalesce(v_tasks->'progress'->>'l_study_1000', '') ~ '^\d+$' then (v_tasks->'progress'->>'l_study_1000')::integer else 0 end;
  if v_study_progress < 5 then raise exception 'Answer more study questions before claiming the chest'; end if;

  select data into v_game_state from user_docs
  where user_id = p_user_id and collection = 'chrono_empires' and doc_id = 'global';
  if coalesce(v_game_state->>'currentBoard', '') ~ '^\d+$' then
    v_board := greatest(100, least(3000, (v_game_state->>'currentBoard')::integer));
  end if;
  v_tier := greatest(1, least(30, floor(v_board / 100.0)::integer));
  v_gold := v_tier * 900;
  v_gems := case when v_tier >= 20 then 3 when v_tier >= 10 then 2 else 1 end;
  v_energy := case when v_tier >= 15 then 2 else 1 end;
  v_card_id := 'b' || ((floor(random() * v_tier)::integer + 1) * 100)::text
    || '_' || (array['geo','foo','ent','his'])[floor(random() * 4)::integer + 1]
    || '_' || (floor(random() * 3)::integer + 1)::text;

  select * into v_inventory from user_docs
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global'
  for update;
  if not found then raise exception 'Chrono inventory not found'; end if;
  v_inventory.data := jsonb_set(v_inventory.data, '{cards}', coalesce(v_inventory.data->'cards', '{}'::jsonb), true);
  v_card := v_inventory.data->'cards'->v_card_id;
  if v_card is null then v_card := jsonb_build_object('copies', 1, 'level', 1);
  else
    v_copies := case when coalesce(v_card->>'copies', '') ~ '^\d+$' then (v_card->>'copies')::integer else 0 end;
    v_card := jsonb_set(v_card, '{copies}', to_jsonb(v_copies + 1), true);
  end if;
  v_inventory.data := jsonb_set(v_inventory.data, array['cards', v_card_id], v_card, true);
  v_reward := jsonb_build_object('coins', v_gold, 'gems', v_gems, 'energy', v_energy, 'cardId', v_card_id);
  v_result := economy_grant_event(
    p_user_id, 'chrono_reward_chest:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
    'chrono_reward_chest', 'chrono_reward_chest/state', v_gold, 0, v_energy, v_gems,
    jsonb_build_object('reward', v_reward)
  );
  update user_docs set data = v_inventory.data, updated_at = now()
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';
  update user_docs set data = data || jsonb_build_object('lastClaimedAt', v_now, 'lastReward', v_reward, 'updatedAt', v_now), updated_at = now()
  where user_id = p_user_id and collection = 'chrono_reward_chest' and doc_id = 'state';
  return v_result || jsonb_build_object('reward', v_reward);
end;
$$;

revoke all on function economy_claim_chrono_reward_chest(text) from public, anon, authenticated;
grant execute on function economy_claim_chrono_reward_chest(text) to service_role;

create or replace function economy_claim_collection_set(p_user_id text, p_set_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_match text[];
  v_board integer;
  v_category text;
  v_prefix text;
  v_inventory jsonb;
  v_state user_docs%rowtype;
  v_owned integer := 0;
  v_tier integer;
  v_gold integer;
  v_gems integer;
  v_claimed_at bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  v_result jsonb;
  i integer;
begin
  v_match := regexp_match(p_set_id, '^set_([0-9]+)_(geography|food|entertainment|history)$');
  if v_match is null then raise exception 'Unknown collection set'; end if;
  v_board := v_match[1]::integer;
  if v_board < 100 or v_board > 3000 or v_board % 100 <> 0 then raise exception 'Invalid collection board'; end if;
  v_category := v_match[2];
  v_prefix := left(v_category, 3);
  select data into v_inventory from user_docs
  where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';
  if v_inventory is null then raise exception 'Chrono inventory not found'; end if;
  for i in 1..3 loop
    if coalesce(v_inventory->'cards'->('b' || v_board::text || '_' || v_prefix || '_' || i::text)->>'level', '0') ~ '^[1-9][0-9]*$' then
      v_owned := v_owned + 1;
    end if;
  end loop;
  if v_owned < 3 then raise exception 'Collection set is incomplete'; end if;

  insert into user_docs(user_id, collection, doc_id, data)
  values (p_user_id, 'chrono_collection_sets', 'state', jsonb_build_object('claimed', '{}'::jsonb, 'updatedAt', now()))
  on conflict (user_id, collection, doc_id) do nothing;
  select * into v_state from user_docs
  where user_id = p_user_id and collection = 'chrono_collection_sets' and doc_id = 'state' for update;
  if coalesce(v_state.data->'claimed', '{}'::jsonb) ? p_set_id then raise exception 'Collection set already claimed'; end if;
  v_tier := v_board / 100;
  v_gold := v_tier * 750 + case v_category when 'entertainment' then 500 when 'food' then 350 else 250 end;
  v_gems := case when v_tier >= 20 then 3 when v_tier >= 10 then 2 else 1 end;
  v_result := economy_grant_event(p_user_id, 'chrono_collection_set:' || p_set_id, 'chrono_collection_set', p_set_id,
    v_gold, 0, 0, v_gems, jsonb_build_object('setId', p_set_id));
  update user_docs set data = jsonb_set(data, '{claimed}', coalesce(data->'claimed', '{}'::jsonb) || jsonb_build_object(p_set_id, v_claimed_at), true), updated_at = now()
  where user_id = p_user_id and collection = 'chrono_collection_sets' and doc_id = 'state';
  return v_result || jsonb_build_object('reward', jsonb_build_object('coins', v_gold, 'gems', v_gems, 'energy', 0));
end;
$$;
revoke all on function economy_claim_collection_set(text,text) from public, anon, authenticated;
grant execute on function economy_claim_collection_set(text,text) to service_role;

create or replace function economy_claim_gem_milestone(p_user_id text, p_milestone_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_match text[];
  v_board integer;
  v_kind text;
  v_inventory jsonb;
  v_board_state jsonb;
  v_state user_docs%rowtype;
  v_progress integer := 0;
  v_card jsonb;
  v_claimed_at bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  v_result jsonb;
  v_prefix text;
  i integer;
  j integer;
begin
  v_match := regexp_match(p_milestone_id, '^gm_([0-9]+)_(cards|set|upgrade|booths)$');
  if v_match is null then raise exception 'Unknown gem milestone'; end if;
  v_board := v_match[1]::integer; v_kind := v_match[2];
  if v_board < 100 or v_board > 3000 or v_board % 100 <> 0 then raise exception 'Invalid milestone board'; end if;
  select data into v_inventory from user_docs where user_id = p_user_id and collection = 'chrono_inventory' and doc_id = 'global';
  if v_kind in ('cards','set','upgrade') and v_inventory is null then raise exception 'Chrono inventory not found'; end if;
  if v_kind = 'booths' then
    select data into v_board_state from user_docs where user_id = p_user_id and collection = 'chrono_board_state' and doc_id = v_board::text;
    select count(*) into v_progress from jsonb_each(coalesce(v_board_state->'booths', '{}'::jsonb)) e where e.value->>'owner' = 'player';
    if v_progress < 2 then raise exception 'Booth milestone is incomplete'; end if;
  else
    for i in 1..4 loop
      v_prefix := (array['geo','foo','ent','his'])[i];
      for j in 1..3 loop
        v_card := v_inventory->'cards'->('b' || v_board::text || '_' || v_prefix || '_' || j::text);
        if coalesce(v_card->>'level','0') ~ '^[1-9][0-9]*$' then
          if v_kind = 'cards' then v_progress := v_progress + 1; end if;
          if v_kind = 'upgrade' and (v_card->>'level')::integer >= 2 then v_progress := v_progress + 1; end if;
        end if;
      end loop;
      if v_kind = 'set' then
        if (select count(*) from generate_series(1,3) as gs(n) where coalesce(v_inventory->'cards'->('b' || v_board::text || '_' || v_prefix || '_' || n::text)->>'level','0') ~ '^[1-9][0-9]*$') = 3 then
          v_progress := v_progress + 1;
        end if;
      end if;
    end loop;
    if (v_kind = 'cards' and v_progress < 3) or (v_kind in ('set','upgrade') and v_progress < 1) then raise exception 'Gem milestone is incomplete'; end if;
  end if;
  insert into user_docs(user_id, collection, doc_id, data) values (p_user_id, 'chrono_gem_milestones', 'state', jsonb_build_object('claimed','{}'::jsonb,'updatedAt',now())) on conflict (user_id,collection,doc_id) do nothing;
  select * into v_state from user_docs where user_id=p_user_id and collection='chrono_gem_milestones' and doc_id='state' for update;
  if coalesce(v_state.data->'claimed','{}'::jsonb) ? p_milestone_id then raise exception 'Gem milestone already claimed'; end if;
  v_result := economy_grant_event(p_user_id, 'chrono_gem_milestone:' || p_milestone_id, 'chrono_gem_milestone', p_milestone_id, 0,0,0,25, jsonb_build_object('milestoneId',p_milestone_id));
  update user_docs set data=jsonb_set(data,'{claimed}',coalesce(data->'claimed','{}'::jsonb)||jsonb_build_object(p_milestone_id,v_claimed_at),true),updated_at=now() where user_id=p_user_id and collection='chrono_gem_milestones' and doc_id='state';
  return v_result || jsonb_build_object('reward',jsonb_build_object('gems',25));
end;
$$;
revoke all on function economy_claim_gem_milestone(text,text) from public, anon, authenticated;
grant execute on function economy_claim_gem_milestone(text,text) to service_role;

create or replace function economy_claim_chrono_battle_pass_tier(
  p_user_id text,
  p_tier integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_state user_docs%rowtype;
  v_tasks jsonb;
  v_sets jsonb;
  v_discovery jsonb;
  v_milestones jsonb;
  v_gifts jsonb;
  v_xp integer := 0;
  v_required integer;
  v_gold integer;
  v_gems integer;
  v_energy integer;
  v_claimed jsonb;
  v_result jsonb;
begin
  if p_tier < 1 or p_tier > 20 then raise exception 'Unknown battle pass tier'; end if;
  v_required := (p_tier - 1) * 100;

  select data into v_tasks from user_docs where user_id=p_user_id and collection='chrono_tasks' and doc_id='state';
  select data into v_sets from user_docs where user_id=p_user_id and collection='chrono_collection_sets' and doc_id='state';
  select data into v_discovery from user_docs where user_id=p_user_id and collection='chrono_discovery' and doc_id='state';
  select data into v_milestones from user_docs where user_id=p_user_id and collection='chrono_gem_milestones' and doc_id='state';
  select data into v_gifts from user_docs where user_id=p_user_id and collection='chrono_friend_gifts' and doc_id='state';

  select v_xp + coalesce(sum(case when value ~ '^-?\d+$' then greatest(0,value::integer) else 0 end),0)::integer * 2
  into v_xp from jsonb_each_text(coalesce(v_tasks->'progress','{}'::jsonb));
  v_xp := v_xp + jsonb_object_length(coalesce(v_tasks->'claimed','{}'::jsonb)) * 20;
  v_xp := v_xp + jsonb_object_length(coalesce(v_sets->'claimed','{}'::jsonb)) * 30;
  v_xp := v_xp + jsonb_array_length(coalesce(v_discovery->'discoveredRecipeIds','[]'::jsonb)) * 35;
  v_xp := v_xp + jsonb_object_length(coalesce(v_milestones->'claimed','{}'::jsonb)) * 40;
  v_xp := v_xp + (select count(*)::integer * 10 from jsonb_each_text(coalesce(v_gifts->'sent','{}'::jsonb)) where value = to_char(now() at time zone 'utc','YYYY-MM-DD'));
  if v_xp < v_required then raise exception 'Battle pass tier is not unlocked'; end if;

  insert into user_docs(user_id,collection,doc_id,data) values (p_user_id,'chrono_battle_pass','state',jsonb_build_object('claimedTiers','[]'::jsonb,'updatedAt',now())) on conflict (user_id,collection,doc_id) do nothing;
  select * into v_state from user_docs where user_id=p_user_id and collection='chrono_battle_pass' and doc_id='state' for update;
  v_claimed := coalesce(v_state.data->'claimedTiers','[]'::jsonb);
  if v_claimed @> jsonb_build_array(p_tier) then raise exception 'Battle pass tier already claimed'; end if;

  v_gold := case when p_tier % 5 = 0 then p_tier * 2500 else p_tier * 800 end;
  v_gems := case when p_tier % 5 = 0 then 5 when p_tier % 2 = 0 then 1 else 0 end;
  v_energy := case when p_tier % 3 = 0 then 1 else 0 end;
  v_result := economy_grant_event(p_user_id,'chrono_battle_pass:'||p_tier::text,'chrono_battle_pass_tier',p_tier::text,v_gold,0,v_energy,v_gems,jsonb_build_object('tier',p_tier,'xp',v_xp));
  update user_docs set data=jsonb_set(data,'{claimedTiers}',v_claimed||jsonb_build_array(p_tier),true),updated_at=now() where user_id=p_user_id and collection='chrono_battle_pass' and doc_id='state';
  return v_result || jsonb_build_object('reward',jsonb_build_object('coins',v_gold,'gems',v_gems,'energy',v_energy),'xp',v_xp);
end;
$$;
revoke all on function economy_claim_chrono_battle_pass_tier(text,integer) from public, anon, authenticated;
grant execute on function economy_claim_chrono_battle_pass_tier(text,integer) to service_role;

create or replace function economy_claim_multiplayer_reward(p_user_id text, p_session_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_session jsonb;
  v_player_key text;
  v_winner text;
  v_won boolean;
  v_drew boolean;
  v_xp integer;
  v_gold integer;
  v_result jsonb;
begin
  select data into v_session from global_docs where collection='gameSessions' and doc_id=p_session_id;
  if v_session is null then raise exception 'Game session not found'; end if;
  if v_session->>'state' <> 'complete' then raise exception 'Game session is not complete'; end if;
  if v_session->'player1'->>'uid' = p_user_id then v_player_key := 'p1';
  elsif v_session->'player2'->>'uid' = p_user_id then v_player_key := 'p2';
  else raise exception 'User is not a participant in this session'; end if;
  v_winner := coalesce(v_session->>'winner','draw');
  v_won := v_winner = v_player_key;
  v_drew := v_winner = 'draw';
  v_xp := case when v_won then 150 when v_drew then 75 else 50 end;
  v_gold := case when v_won then 50 else 0 end;
  v_result := economy_grant_event(p_user_id,'multiplayer_reward:'||p_session_id,'multiplayer_match_reward',p_session_id,v_gold,v_xp,0,0,jsonb_build_object('result',case when v_won then 'win' when v_drew then 'draw' else 'loss' end));
  return v_result || jsonb_build_object('reward',jsonb_build_object('gold',v_gold,'xp',v_xp),'result',case when v_won then 'win' when v_drew then 'draw' else 'loss' end);
end;
$$;
revoke all on function economy_claim_multiplayer_reward(text,text) from public, anon, authenticated;
grant execute on function economy_claim_multiplayer_reward(text,text) to service_role;

create or replace function economy_start_matchmaking(
  p_user_id text,
  p_game_id text,
  p_attempt_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_username text;
  v_entry_id text := p_game_id || '_' || p_user_id;
  v_opponent global_docs%rowtype;
  v_existing_entry global_docs%rowtype;
  v_session_id text;
  v_session jsonb;
  v_fee_result jsonb;
  v_now text := to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_game_id !~ '^[A-Za-z0-9_-]{2,80}$' or p_attempt_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Invalid matchmaking request'; end if;
  perform pg_advisory_xact_lock(hashtext('matchmaking:' || p_game_id));
  select coalesce(nullif(username,''),'Player') into v_username from profiles where id=p_user_id;
  if v_username is null then raise exception 'Player profile not found'; end if;

  v_fee_result := economy_grant_event(p_user_id,'matchmaking_fee:'||p_attempt_id,'matchmaking_entry_fee',p_attempt_id,-25,0,0,0,jsonb_build_object('gameId',p_game_id));
  if not coalesce((v_fee_result->>'applied')::boolean,false) then
    select * into v_existing_entry from global_docs where collection='matchmakingQueue' and doc_id=v_entry_id and data->>'attemptId'=p_attempt_id;
    if found then
      if v_existing_entry.data->>'sessionId' is not null then
        select data into v_session from global_docs where collection='gameSessions' and doc_id=v_existing_entry.data->>'sessionId';
        return v_fee_result || jsonb_build_object('matched',v_session is not null,'entryId',v_entry_id,'session',v_session);
      end if;
      return v_fee_result || jsonb_build_object('matched',false,'entryId',v_entry_id);
    end if;
    raise exception 'Matchmaking attempt state is missing';
  end if;
  insert into global_docs(collection,doc_id,data,updated_at) values ('matchmakingQueue',v_entry_id,jsonb_build_object(
    'uid',p_user_id,'username',v_username,'gameId',p_game_id,'joinedAt',v_now,'sessionId',null,'attemptId',p_attempt_id
  ),now()) on conflict (collection,doc_id) do update set data=excluded.data,updated_at=now();

  select * into v_opponent from global_docs
  where collection='matchmakingQueue' and doc_id<>v_entry_id
    and data->>'gameId'=p_game_id and data->>'sessionId' is null
    and updated_at > now()-interval '30 seconds'
  order by data->>'joinedAt' asc limit 1 for update;
  if found then
    v_session_id := encode(gen_random_bytes(7),'hex');
    v_session := jsonb_build_object(
      'id',v_session_id,'gameId',p_game_id,'mode','ranked','state','playing','currentRound',1,
      'player1',jsonb_build_object('uid',v_opponent.data->>'uid','username',v_opponent.data->>'username','roundScore',null,'roundWins',0,'isBot',false),
      'player2',jsonb_build_object('uid',p_user_id,'username',v_username,'roundScore',null,'roundWins',0,'isBot',false),
      'rounds','[]'::jsonb,'createdAt',v_now
    );
    insert into global_docs(collection,doc_id,data,updated_at) values ('gameSessions',v_session_id,v_session,now());
    update global_docs set data=jsonb_set(data,'{sessionId}',to_jsonb(v_session_id),true),updated_at=now()
    where collection='matchmakingQueue' and doc_id in (v_entry_id,v_opponent.doc_id);
    return v_fee_result || jsonb_build_object('matched',true,'entryId',v_entry_id,'session',v_session);
  end if;
  return v_fee_result || jsonb_build_object('matched',false,'entryId',v_entry_id);
end;
$$;
revoke all on function economy_start_matchmaking(text,text,text) from public, anon, authenticated;
grant execute on function economy_start_matchmaking(text,text,text) to service_role;

create or replace function economy_cancel_matchmaking(
  p_user_id text,
  p_game_id text,
  p_attempt_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_entry global_docs%rowtype;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('matchmaking:' || p_game_id));
  select * into v_entry from global_docs where collection='matchmakingQueue' and doc_id=p_game_id||'_'||p_user_id for update;
  if not found then raise exception 'Matchmaking entry not found'; end if;
  if v_entry.data->>'uid'<>p_user_id or v_entry.data->>'attemptId'<>p_attempt_id then raise exception 'Matchmaking attempt mismatch'; end if;
  if v_entry.data->>'sessionId' is not null then raise exception 'Match already created'; end if;
  if not exists(select 1 from economy_ledger where user_id=p_user_id and event_key='matchmaking_fee:'||p_attempt_id and gold_delta=-25) then raise exception 'Matchmaking fee not found'; end if;
  delete from global_docs where collection='matchmakingQueue' and doc_id=v_entry.doc_id;
  v_result := economy_grant_event(p_user_id,'matchmaking_refund:'||p_attempt_id,'matchmaking_cancel_refund',p_attempt_id,25,0,0,0,jsonb_build_object('gameId',p_game_id));
  return v_result;
end;
$$;
revoke all on function economy_cancel_matchmaking(text,text,text) from public, anon, authenticated;
grant execute on function economy_cancel_matchmaking(text,text,text) to service_role;

create or replace function economy_start_bot_match(
  p_user_id text,
  p_game_id text,
  p_attempt_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_entry global_docs%rowtype;
  v_username text;
  v_session_id text;
  v_session jsonb;
  v_now text := to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_game_id !~ '^[A-Za-z0-9_-]{2,80}$' or p_attempt_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Invalid matchmaking request';
  end if;
  perform pg_advisory_xact_lock(hashtext('matchmaking:' || p_game_id));
  select * into v_entry from global_docs
  where collection='matchmakingQueue' and doc_id=p_game_id||'_'||p_user_id for update;
  if not found then raise exception 'Matchmaking entry not found'; end if;
  if v_entry.data->>'uid'<>p_user_id or v_entry.data->>'attemptId'<>p_attempt_id then
    raise exception 'Matchmaking attempt mismatch';
  end if;
  if v_entry.data->>'sessionId' is not null then
    select data into v_session from global_docs
    where collection='gameSessions' and doc_id=v_entry.data->>'sessionId';
    if v_session is null then raise exception 'Matchmaking session is missing'; end if;
    return jsonb_build_object('matched',true,'entryId',v_entry.doc_id,'session',v_session);
  end if;
  if not exists(
    select 1 from economy_ledger
    where user_id=p_user_id and event_key='matchmaking_fee:'||p_attempt_id and gold_delta=-25
  ) then raise exception 'Matchmaking fee not found'; end if;

  select coalesce(nullif(username,''),'Player') into v_username from profiles where id=p_user_id;
  if v_username is null then raise exception 'Player profile not found'; end if;
  v_session_id := encode(gen_random_bytes(7),'hex');
  v_session := jsonb_build_object(
    'id',v_session_id,'gameId',p_game_id,'mode','ranked','state','playing','currentRound',1,
    'player1',jsonb_build_object('uid',p_user_id,'username',v_username,'roundScore',null,'roundWins',0,'isBot',false),
    'player2',jsonb_build_object('uid','logicbot_medium','username','LogicBot','roundScore',null,'roundWins',0,'isBot',true),
    'rounds','[]'::jsonb,'createdAt',v_now
  );
  insert into global_docs(collection,doc_id,data,updated_at)
  values('gameSessions',v_session_id,v_session,now());
  update global_docs
  set data=jsonb_set(data,'{sessionId}',to_jsonb(v_session_id),true),updated_at=now()
  where collection='matchmakingQueue' and doc_id=v_entry.doc_id;
  return jsonb_build_object('matched',true,'entryId',v_entry.doc_id,'session',v_session);
end;
$$;
revoke all on function economy_start_bot_match(text,text,text) from public, anon, authenticated;
grant execute on function economy_start_bot_match(text,text,text) to service_role;

create or replace function game_session_send_challenge(
  p_user_id text,
  p_to_username text,
  p_game_id text,
  p_game_label text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_from_username text;
  v_to_user_id text;
  v_to_username text;
  v_challenge_id text:=encode(gen_random_bytes(7),'hex');
  v_notification_id text:=encode(gen_random_bytes(7),'hex');
  v_now text:=to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if length(trim(p_to_username))<1 or length(trim(p_to_username))>80
     or p_game_id!~'^[A-Za-z0-9_-]{2,80}$'
     or length(trim(p_game_label))<1 or length(trim(p_game_label))>100 then
    raise exception 'Invalid challenge request';
  end if;
  select coalesce(nullif(username,''),'Player') into v_from_username from profiles where id=p_user_id;
  select id,coalesce(nullif(username,''),'Player') into v_to_user_id,v_to_username
  from profiles where lower(username)=lower(trim(p_to_username)) limit 1;
  if v_from_username is null then raise exception 'Challenger profile not found'; end if;
  if v_to_user_id is null then raise exception 'Username not found'; end if;
  if v_to_user_id=p_user_id then raise exception 'You cannot challenge yourself'; end if;

  insert into global_docs(collection,doc_id,data,updated_at) values(
    'challenges',v_challenge_id,
    jsonb_build_object('id',v_challenge_id,'fromUid',p_user_id,'fromUsername',v_from_username,
      'toUid',v_to_user_id,'toUsername',v_to_username,'gameId',p_game_id,'gameLabel',trim(p_game_label),
      'kind','warmup','state','pending','createdAt',v_now),now()
  );
  insert into global_docs(collection,doc_id,data,updated_at) values(
    'notifications:'||v_to_user_id,v_notification_id,
    jsonb_build_object('id',v_notification_id,'fromUid',p_user_id,'fromUsername',v_from_username,
      'type','challenge','message',v_from_username||' challenged you in '||trim(p_game_label)||'.',
      'createdAt',v_now,'read',false,'resolved',false,'challengeId',v_challenge_id,
      'gameId',p_game_id,'gameLabel',trim(p_game_label),'kind','warmup'),now()
  );
  return jsonb_build_object('success',true,'challengeId',v_challenge_id);
end;
$$;
revoke all on function game_session_send_challenge(text,text,text,text) from public,anon,authenticated;
grant execute on function game_session_send_challenge(text,text,text,text) to service_role;

create or replace function game_session_cancel_challenge(p_user_id text,p_challenge_id text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_row global_docs%rowtype;
begin
  select * into v_row from global_docs where collection='challenges' and doc_id=p_challenge_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if coalesce(v_row.data->>'kind','warmup')<>'warmup' then raise exception 'Not a warmup challenge'; end if;
  if v_row.data->>'fromUid'<>p_user_id then raise exception 'Challenge sender mismatch'; end if;
  if v_row.data->>'state'<>'pending' then return v_row.data; end if;
  v_row.data:=jsonb_set(v_row.data,'{state}','"canceled"'::jsonb,true);
  update global_docs set data=v_row.data,updated_at=now()
  where collection='challenges' and doc_id=p_challenge_id;
  return v_row.data;
end;
$$;
revoke all on function game_session_cancel_challenge(text,text) from public,anon,authenticated;
grant execute on function game_session_cancel_challenge(text,text) to service_role;

create or replace function game_session_decline_challenge(p_user_id text,p_challenge_id text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_row global_docs%rowtype;
begin
  select * into v_row from global_docs where collection='challenges' and doc_id=p_challenge_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if coalesce(v_row.data->>'kind','warmup')<>'warmup' then raise exception 'Not a warmup challenge'; end if;
  if v_row.data->>'toUid'<>p_user_id then raise exception 'Challenge recipient mismatch'; end if;
  if v_row.data->>'state'<>'pending' then return v_row.data; end if;
  v_row.data:=jsonb_set(v_row.data,'{state}','"declined"'::jsonb,true);
  update global_docs set data=v_row.data,updated_at=now()
  where collection='challenges' and doc_id=p_challenge_id;
  return v_row.data;
end;
$$;
revoke all on function game_session_decline_challenge(text,text) from public,anon,authenticated;
grant execute on function game_session_decline_challenge(text,text) to service_role;

create or replace function game_session_accept_challenge(p_user_id text, p_challenge_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_challenge global_docs%rowtype;
  v_from_username text;
  v_to_username text;
  v_session_id text;
  v_session jsonb;
  v_now text := to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_challenge_id !~ '^[A-Za-z0-9_-]{5,100}$' then raise exception 'Invalid challenge'; end if;
  select * into v_challenge from global_docs
  where collection='challenges' and doc_id=p_challenge_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if coalesce(v_challenge.data->>'kind','warmup')<>'warmup' then raise exception 'Not a warmup challenge'; end if;
  if v_challenge.data->>'toUid'<>p_user_id then raise exception 'Challenge recipient mismatch'; end if;
  if v_challenge.data->>'state'='accepted' and v_challenge.data->>'sessionId' is not null then
    select data into v_session from global_docs
    where collection='gameSessions' and doc_id=v_challenge.data->>'sessionId';
    if v_session is null then raise exception 'Challenge session is missing'; end if;
    return v_session;
  end if;
  if v_challenge.data->>'state'<>'pending' then raise exception 'Challenge is no longer pending'; end if;
  if coalesce(v_challenge.data->>'gameId','') !~ '^[A-Za-z0-9_-]{2,80}$' then raise exception 'Invalid challenge game'; end if;

  select coalesce(nullif(username,''),'Player') into v_from_username
  from profiles where id=v_challenge.data->>'fromUid';
  select coalesce(nullif(username,''),'Player') into v_to_username
  from profiles where id=p_user_id;
  if v_from_username is null or v_to_username is null then raise exception 'Challenge profile not found'; end if;

  v_session_id := encode(gen_random_bytes(7),'hex');
  v_session := jsonb_build_object(
    'id',v_session_id,'gameId',v_challenge.data->>'gameId','mode','friend','state','playing','currentRound',1,
    'player1',jsonb_build_object('uid',v_challenge.data->>'fromUid','username',v_from_username,'roundScore',null,'roundWins',0,'isBot',false),
    'player2',jsonb_build_object('uid',p_user_id,'username',v_to_username,'roundScore',null,'roundWins',0,'isBot',false),
    'rounds','[]'::jsonb,'createdAt',v_now
  );
  insert into global_docs(collection,doc_id,data,updated_at)
  values('gameSessions',v_session_id,v_session,now());
  update global_docs set data=data||jsonb_build_object('state','accepted','sessionId',v_session_id),updated_at=now()
  where collection='challenges' and doc_id=p_challenge_id;
  return v_session;
end;
$$;
revoke all on function game_session_accept_challenge(text,text) from public,anon,authenticated;
grant execute on function game_session_accept_challenge(text,text) to service_role;

create or replace function game_session_submit_score(
  p_user_id text,
  p_session_id text,
  p_round integer,
  p_score integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row global_docs%rowtype;
  v_session jsonb;
  v_player_key text;
  v_opponent_key text;
  v_game text;
  v_bot_score integer;
  v_low integer;
  v_high integer;
begin
  if p_session_id !~ '^[A-Za-z0-9_-]{8,100}$' or p_round<1 or p_round>5 or p_score<0 or p_score>10000000 then
    raise exception 'Invalid round score';
  end if;
  perform pg_advisory_xact_lock(hashtext('game-session:'||p_session_id));
  select * into v_row from global_docs where collection='gameSessions' and doc_id=p_session_id for update;
  if not found then raise exception 'Game session not found'; end if;
  v_session := v_row.data;
  if v_session->>'state'='complete' then raise exception 'Game session is complete'; end if;
  if coalesce((v_session->>'currentRound')::integer,0)<>p_round then raise exception 'Round is no longer active'; end if;
  if v_session->'player1'->>'uid'=p_user_id then v_player_key:='player1'; v_opponent_key:='player2';
  elsif v_session->'player2'->>'uid'=p_user_id then v_player_key:='player2'; v_opponent_key:='player1';
  else raise exception 'User is not a participant in this session'; end if;
  if v_session->v_player_key->>'roundScore' is not null then
    if (v_session->v_player_key->>'roundScore')::integer=p_score then return v_session; end if;
    raise exception 'Score already submitted';
  end if;

  v_session := jsonb_set(v_session,array[v_player_key,'roundScore'],to_jsonb(p_score),true);
  if coalesce((v_session->v_opponent_key->>'isBot')::boolean,false)
     and v_session->v_opponent_key->>'roundScore' is null then
    v_game := regexp_replace(v_session->>'gameId','_(10s|60s)$','','i');
    select low,high into v_low,v_high from (values
      ('quickMath',6,12),('advQuickMath',4,9),('compareExp',7,13),('trueFalse',8,15),
      ('missingOp',7,12),('completeEq',5,11),('sequence',4,8),('pyramid',3,7),
      ('memoCells',3,6),('memoOrder',3,6),('blockPuzzle',200,600),('fifteenPuzzle',30,70),
      ('neonGrid',4,9),('flipCup',3,7),('ticTacToe',1,3),('chessMemory',7,14)
    ) as ranges(game,low,high) where game=v_game;
    v_low:=coalesce(v_low,3); v_high:=coalesce(v_high,8);
    v_bot_score:=floor(random()*(v_high-v_low+1)+v_low)::integer;
    v_session:=jsonb_set(v_session,array[v_opponent_key,'roundScore'],to_jsonb(v_bot_score),true);
  end if;
  v_session:=jsonb_set(v_session,'{state}','"playing"'::jsonb,true);
  update global_docs set data=v_session,updated_at=now()
  where collection='gameSessions' and doc_id=p_session_id;
  return v_session;
end;
$$;
revoke all on function game_session_submit_score(text,text,integer,integer) from public,anon,authenticated;
grant execute on function game_session_submit_score(text,text,integer,integer) to service_role;

create or replace function game_session_resolve_round(p_user_id text, p_session_id text, p_round integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row global_docs%rowtype;
  v_session jsonb;
  v_p1_score integer;
  v_p2_score integer;
  v_p1_wins integer;
  v_p2_wins integer;
  v_round_winner text;
  v_match_winner text;
  v_match_over boolean;
  v_round_result jsonb;
begin
  if p_session_id !~ '^[A-Za-z0-9_-]{8,100}$' or p_round<1 or p_round>5 then raise exception 'Invalid round'; end if;
  perform pg_advisory_xact_lock(hashtext('game-session:'||p_session_id));
  select * into v_row from global_docs where collection='gameSessions' and doc_id=p_session_id for update;
  if not found then raise exception 'Game session not found'; end if;
  v_session:=v_row.data;
  if v_session->'player1'->>'uid'<>p_user_id and v_session->'player2'->>'uid'<>p_user_id then
    raise exception 'User is not a participant in this session';
  end if;
  if coalesce((v_session->>'currentRound')::integer,0)>p_round or v_session->>'state'='complete' then return v_session; end if;
  if coalesce((v_session->>'currentRound')::integer,0)<>p_round then raise exception 'Round is no longer active'; end if;
  if v_session->'player1'->>'roundScore' is null or v_session->'player2'->>'roundScore' is null then
    raise exception 'Both scores are required';
  end if;
  v_p1_score:=(v_session->'player1'->>'roundScore')::integer;
  v_p2_score:=(v_session->'player2'->>'roundScore')::integer;
  v_round_winner:=case when v_p1_score>v_p2_score then 'p1' when v_p2_score>v_p1_score then 'p2' else 'draw' end;
  v_p1_wins:=coalesce((v_session->'player1'->>'roundWins')::integer,0)+case when v_round_winner='p1' then 1 else 0 end;
  v_p2_wins:=coalesce((v_session->'player2'->>'roundWins')::integer,0)+case when v_round_winner='p2' then 1 else 0 end;
  v_round_result:=jsonb_build_object('round',p_round,'p1Score',v_p1_score,'p2Score',v_p2_score,'winner',v_round_winner);
  v_session:=jsonb_set(v_session,'{rounds}',coalesce(v_session->'rounds','[]'::jsonb)||jsonb_build_array(v_round_result),true);
  v_session:=jsonb_set(v_session,'{player1,roundWins}',to_jsonb(v_p1_wins),true);
  v_session:=jsonb_set(v_session,'{player2,roundWins}',to_jsonb(v_p2_wins),true);
  v_session:=jsonb_set(v_session,'{player1,roundScore}','null'::jsonb,true);
  v_session:=jsonb_set(v_session,'{player2,roundScore}','null'::jsonb,true);
  v_match_over:=v_p1_wins>=3 or v_p2_wins>=3 or jsonb_array_length(v_session->'rounds')>=5;
  v_session:=jsonb_set(v_session,'{currentRound}',to_jsonb(p_round+1),true);
  if v_match_over then
    v_match_winner:=case when v_p1_wins>v_p2_wins then 'p1' when v_p2_wins>v_p1_wins then 'p2' else 'draw' end;
    v_session:=jsonb_set(v_session,'{state}','"complete"'::jsonb,true);
    v_session:=jsonb_set(v_session,'{winner}',to_jsonb(v_match_winner),true);
  else
    v_session:=jsonb_set(v_session,'{state}','"round_end"'::jsonb,true);
  end if;
  update global_docs set data=v_session,updated_at=now()
  where collection='gameSessions' and doc_id=p_session_id;
  return v_session;
end;
$$;
revoke all on function game_session_resolve_round(text,text,integer) from public,anon,authenticated;
grant execute on function game_session_resolve_round(text,text,integer) to service_role;

create or replace function game_session_forfeit(p_user_id text, p_session_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row global_docs%rowtype; v_session jsonb; v_winner text;
begin
  if p_session_id !~ '^[A-Za-z0-9_-]{8,100}$' then raise exception 'Invalid game session'; end if;
  perform pg_advisory_xact_lock(hashtext('game-session:'||p_session_id));
  select * into v_row from global_docs where collection='gameSessions' and doc_id=p_session_id for update;
  if not found then raise exception 'Game session not found'; end if;
  v_session:=v_row.data;
  if v_session->>'state'='complete' then return v_session; end if;
  if v_session->'player1'->>'uid'=p_user_id then v_winner:='p2';
  elsif v_session->'player2'->>'uid'=p_user_id then v_winner:='p1';
  else raise exception 'User is not a participant in this session'; end if;
  v_session:=jsonb_set(v_session,'{state}','"complete"'::jsonb,true);
  v_session:=jsonb_set(v_session,'{winner}',to_jsonb(v_winner),true);
  update global_docs set data=v_session,updated_at=now()
  where collection='gameSessions' and doc_id=p_session_id;
  return v_session;
end;
$$;
revoke all on function game_session_forfeit(text,text) from public,anon,authenticated;
grant execute on function game_session_forfeit(text,text) to service_role;

create or replace function game_session_quick_chat(p_user_id text, p_session_id text, p_text text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row global_docs%rowtype; v_session jsonb; v_username text; v_now text:=to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_session_id !~ '^[A-Za-z0-9_-]{8,100}$' or p_text<>all(array['Good luck!','Nice!','Wow 😮','GG','Rematch?','Hurry up ⏳','🔥','💯','😂','😅','😎','😡','👍','👎','🎉','🤝','💀','🧠']) then
    raise exception 'Invalid quick chat message';
  end if;
  perform pg_advisory_xact_lock(hashtext('game-session:'||p_session_id));
  select * into v_row from global_docs where collection='gameSessions' and doc_id=p_session_id for update;
  if not found then raise exception 'Game session not found'; end if;
  v_session:=v_row.data;
  if v_session->>'mode'<>'friend' or v_session->>'state'='complete' then raise exception 'Quick chat is unavailable'; end if;
  if v_session->'player1'->>'uid'<>p_user_id and v_session->'player2'->>'uid'<>p_user_id then raise exception 'User is not a participant in this session'; end if;
  if v_session->'quickChat'->>'createdAt' is not null and (v_session->'quickChat'->>'createdAt')::timestamptz>now()-interval '2 seconds' then raise exception 'Quick chat rate limit'; end if;
  select coalesce(nullif(username,''),'Player') into v_username from profiles where id=p_user_id;
  v_session:=jsonb_set(v_session,'{quickChat}',jsonb_build_object('fromUid',p_user_id,'fromUsername',v_username,'text',p_text,'createdAt',v_now),true);
  update global_docs set data=v_session,updated_at=now() where collection='gameSessions' and doc_id=p_session_id;
  return v_session;
end;
$$;
revoke all on function game_session_quick_chat(text,text,text) from public,anon,authenticated;
grant execute on function game_session_quick_chat(text,text,text) to service_role;

create or replace function economy_roll_chrono_board(
  p_user_id text,
  p_board_id integer,
  p_pay_bail boolean,
  p_turn_id text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_board_state jsonb;
  v_progress user_docs%rowtype;
  v_existing economy_ledger%rowtype;
  v_balance user_economy%rowtype;
  v_cur_pos integer := 0;
  v_cur_jail integer := 0;
  v_cur_extra integer := 0;
  v_next_pos integer;
  v_next_jail integer;
  v_next_extra integer;
  v_roll integer;
  v_gold_delta integer := 0;
  v_energy_delta integer := 0;
  v_event text := '';
  v_now text := to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_next jsonb;
  v_result jsonb;
begin
  if p_board_id<100 or p_board_id>3000 or p_board_id%100<>0 or p_turn_id!~'^[A-Za-z0-9_-]{8,80}$' then raise exception 'Invalid Chrono board turn'; end if;
  select * into v_existing from economy_ledger where user_id=p_user_id and event_key='chrono_board_turn:'||p_turn_id;
  if found then
    select * into v_balance from user_economy where user_id=p_user_id;
    return jsonb_build_object('applied',false,'balance',jsonb_build_object('gold',v_balance.gold,'xp',v_balance.global_xp,'energy',v_balance.energy,'gems',v_balance.gems,'rankedEnergyStreak',v_balance.ranked_energy_streak),'progress',v_existing.metadata->'progress','gold',v_balance.gold);
  end if;
  select data into v_board_state from user_docs where user_id=p_user_id and collection='chrono_empires' and doc_id='global';
  if coalesce(v_board_state->>'currentBoard','') !~ '^\d+$' or (v_board_state->>'currentBoard')::integer<>p_board_id then raise exception 'Board is not currently active'; end if;
  insert into user_docs(user_id,collection,doc_id,data) values (p_user_id,'chrono_board',p_board_id::text,jsonb_build_object('id',p_board_id::text,'boardId',p_board_id,'position',0,'jailTurnsRemaining',0,'extraRolls',0,'updatedAt',v_now)) on conflict(user_id,collection,doc_id) do nothing;
  select * into v_progress from user_docs where user_id=p_user_id and collection='chrono_board' and doc_id=p_board_id::text for update;
  v_cur_pos := case when coalesce(v_progress.data->>'position','')~'^\d+$' then greatest(0,least(27,(v_progress.data->>'position')::integer)) else 0 end;
  v_cur_jail := case when coalesce(v_progress.data->>'jailTurnsRemaining','')~'^\d+$' then greatest(0,least(9,(v_progress.data->>'jailTurnsRemaining')::integer)) else 0 end;
  v_cur_extra := case when coalesce(v_progress.data->>'extraRolls','')~'^\d+$' then greatest(0,least(9,(v_progress.data->>'extraRolls')::integer)) else 0 end;
  v_next_pos:=v_cur_pos; v_next_jail:=v_cur_jail; v_next_extra:=v_cur_extra;
  if v_cur_jail>0 and not p_pay_bail then
    v_next_jail:=greatest(0,v_cur_jail-1); v_event:='Maintenance Mode: turn skipped.';
    v_next:=jsonb_build_object('id',p_board_id::text,'boardId',p_board_id,'position',v_next_pos,'jailTurnsRemaining',v_next_jail,'extraRolls',v_next_extra,'lastEvent',v_event,'updatedAt',v_now);
  else
    if v_cur_jail>0 and p_pay_bail then v_gold_delta:=-100; v_next_jail:=0; v_event:='Paid bail (-100). '; end if;
    v_roll:=floor(random()*6)::integer+1+floor(random()*6)::integer+1;
    v_next_pos:=(v_cur_pos+v_roll)%28;
    if v_cur_extra>0 then v_next_extra:=greatest(0,v_cur_extra-1); end if;
    if v_next_pos<v_cur_pos and v_next_pos<>0 then v_gold_delta:=v_gold_delta+200; v_event:=v_event||'Passed Main Gate: +200 coins. '; end if;
    if v_next_pos=0 then v_gold_delta:=v_gold_delta+200; v_next_extra:=v_next_extra+1; v_event:='🚪 MAIN GATE: +200 coins, +1 free spin!';
    elsif v_next_pos=7 then v_event:=v_event||'🚦 Zahma — just visiting.';
    elsif v_next_pos=14 then v_energy_delta:=1; v_event:=v_event||'☕ El Ahwa — safe zone, +1 energy.';
    elsif v_next_pos=21 then v_next_pos:=7; v_next_jail:=greatest(v_next_jail,1); v_event:='🛑 El Lagna! Checkpoint sends you to Zahma (Traffic Jam).';
    elsif v_event='' then v_event:='Moved.'; end if;
    v_next:=jsonb_build_object('id',p_board_id::text,'boardId',p_board_id,'position',v_next_pos,'lastRoll',v_roll,'jailTurnsRemaining',v_next_jail,'extraRolls',v_next_extra,'lastEvent',v_event,'updatedAt',v_now);
  end if;
  v_result:=economy_grant_event(p_user_id,'chrono_board_turn:'||p_turn_id,'chrono_board_turn',p_board_id::text,v_gold_delta,0,v_energy_delta,0,jsonb_build_object('progress',v_next));
  update user_docs set data=v_next,updated_at=now() where user_id=p_user_id and collection='chrono_board' and doc_id=p_board_id::text;
  return v_result||jsonb_build_object('progress',v_next,'gold',(v_result->'balance'->>'gold')::integer);
end;
$$;
revoke all on function economy_roll_chrono_board(text,integer,boolean,text) from public, anon, authenticated;
grant execute on function economy_roll_chrono_board(text,integer,boolean,text) to service_role;

create or replace function economy_complete_curriculum_objective(
  p_user_id text,
  p_curriculum_id text,
  p_chapter_id text,
  p_objective_id text,
  p_xp integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_state jsonb;
  v_progress jsonb;
  v_curriculum jsonb;
  v_chapter jsonb;
  v_objective jsonb;
  v_now text := to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_gold integer;
  v_result jsonb;
begin
  if p_xp<1 or p_xp>500 then raise exception 'Invalid objective reward'; end if;
  select * into v_profile from profiles where id=p_user_id for update;
  if not found then raise exception 'Student profile not found'; end if;
  v_state:=coalesce(v_profile.user_state,'{}'::jsonb);
  if coalesce(v_state#>>array['progress',p_curriculum_id,p_chapter_id,p_objective_id,'mastered'],'false')='true' then raise exception 'Objective already completed'; end if;
  v_progress:=coalesce(v_state->'progress','{}'::jsonb);
  v_curriculum:=coalesce(v_progress->p_curriculum_id,'{}'::jsonb);
  v_chapter:=coalesce(v_curriculum->p_chapter_id,'{}'::jsonb);
  v_objective:=jsonb_build_object('mastered',true,'xpAwarded',p_xp,'completedAt',v_now);
  v_chapter:=v_chapter||jsonb_build_object(p_objective_id,v_objective);
  v_curriculum:=jsonb_set(v_curriculum,array[p_chapter_id],v_chapter,true);
  v_progress:=jsonb_set(v_progress,array[p_curriculum_id],v_curriculum,true);
  v_state:=jsonb_set(v_state,'{progress}',v_progress,true);
  v_gold:=floor(p_xp/5.0)::integer;
  v_result:=economy_grant_event(p_user_id,'curriculum_objective:'||p_curriculum_id||':'||p_chapter_id||':'||p_objective_id,'curriculum_objective',p_curriculum_id||':'||p_chapter_id||':'||p_objective_id,v_gold,p_xp,0,0,jsonb_build_object('xp',p_xp));
  update profiles set user_state=v_state,updated_at=now() where id=p_user_id;
  return v_result||jsonb_build_object('objective',v_objective,'reward',jsonb_build_object('gold',v_gold,'xp',p_xp));
end;
$$;
revoke all on function economy_complete_curriculum_objective(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function economy_complete_curriculum_objective(text,text,text,text,integer) to service_role;

create table if not exists arena_sessions (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  enemy_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result text,
  stats jsonb
);
create index if not exists arena_sessions_user_started_idx on arena_sessions(user_id,started_at desc);
alter table arena_sessions enable row level security;
drop policy if exists arena_sessions_select_own on arena_sessions;
create policy arena_sessions_select_own on arena_sessions for select to authenticated using(user_id=auth.uid()::text);

create or replace function economy_start_arena_battle(p_user_id text,p_enemy_id text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_id text:=encode(gen_random_bytes(12),'hex'); v_xp integer;
begin
  if p_enemy_id not in ('circuit_bot','scholar_mage','logic_drake','logic_lord') then raise exception 'Unknown Arena enemy'; end if;
  select global_xp into v_xp from user_economy where user_id=p_user_id;
  if p_enemy_id='logic_drake' and coalesce(v_xp,0)<6000 then raise exception 'Arena enemy requires level 5'; end if;
  if p_enemy_id='logic_lord' and coalesce(v_xp,0)<25000 then raise exception 'Arena enemy requires level 8'; end if;
  insert into arena_sessions(id,user_id,enemy_id) values(v_id,p_user_id,p_enemy_id);
  return jsonb_build_object('sessionId',v_id,'enemyId',p_enemy_id,'startedAt',now());
end;
$$;
revoke all on function economy_start_arena_battle(text,text) from public,anon,authenticated;
grant execute on function economy_start_arena_battle(text,text) to service_role;

create or replace function economy_complete_arena_battle(p_user_id text,p_session_id text,p_won boolean,p_stats jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_session arena_sessions%rowtype; v_correct integer; v_wrong integer; v_total integer; v_streak integer; v_base_xp integer; v_base_gold integer; v_xp integer; v_gold integer; v_profile profiles%rowtype; v_arena jsonb; v_result jsonb;
begin
  select * into v_session from arena_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Arena session not found'; end if;
  if v_session.completed_at is not null then raise exception 'Arena session already completed'; end if;
  if now()<v_session.started_at+interval '5 seconds' or now()>v_session.started_at+interval '30 minutes' then raise exception 'Arena session duration is invalid'; end if;
  v_correct:=case when coalesce(p_stats->>'correct','')~'^\d+$' then (p_stats->>'correct')::integer else -1 end;
  v_wrong:=case when coalesce(p_stats->>'wrong','')~'^\d+$' then (p_stats->>'wrong')::integer else -1 end;
  v_total:=case when coalesce(p_stats->>'totalQuestions','')~'^\d+$' then (p_stats->>'totalQuestions')::integer else -1 end;
  v_streak:=case when coalesce(p_stats->>'highestStreak','')~'^\d+$' then (p_stats->>'highestStreak')::integer else 0 end;
  if v_correct<0 or v_wrong<0 or v_total<1 or v_total>12 or v_correct+v_wrong<>v_total or v_streak>v_correct or (p_won and v_correct<2) then raise exception 'Arena battle statistics are invalid'; end if;
  select case v_session.enemy_id when 'circuit_bot' then 80 when 'scholar_mage' then 180 when 'logic_drake' then 350 else 700 end,
         case v_session.enemy_id when 'circuit_bot' then 50 when 'scholar_mage' then 120 when 'logic_drake' then 250 else 500 end into v_base_xp,v_base_gold;
  v_xp:=case when p_won then v_base_xp else floor(v_base_xp*0.15)::integer end;
  v_gold:=case when p_won then v_base_gold else floor(v_base_gold*0.10)::integer end;
  v_result:=economy_grant_event(p_user_id,'arena_battle:'||p_session_id,'arena_battle',v_session.enemy_id,v_gold,v_xp,0,0,jsonb_build_object('won',p_won,'stats',p_stats));
  select * into v_profile from profiles where id=p_user_id for update;
  v_arena:=coalesce(v_profile.arena_stats,'{}'::jsonb);
  v_arena:=v_arena||jsonb_build_object(
    'wins',(case when coalesce(v_arena->>'wins','')~'^\d+$' then (v_arena->>'wins')::integer else 0 end)+case when p_won then 1 else 0 end,
    'losses',(case when coalesce(v_arena->>'losses','')~'^\d+$' then (v_arena->>'losses')::integer else 0 end)+case when p_won then 0 else 1 end,
    'highestStreak',greatest(case when coalesce(v_arena->>'highestStreak','')~'^\d+$' then (v_arena->>'highestStreak')::integer else 0 end,v_streak)
  );
  update profiles set arena_stats=v_arena,updated_at=now() where id=p_user_id;
  update arena_sessions set completed_at=now(),result=case when p_won then 'win' else 'loss' end,stats=p_stats where id=p_session_id;
  return v_result||jsonb_build_object('reward',jsonb_build_object('gold',v_gold,'xp',v_xp),'won',p_won);
end;
$$;
revoke all on function economy_complete_arena_battle(text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function economy_complete_arena_battle(text,text,boolean,jsonb) to service_role;

create or replace function economy_admin_adjust(
  p_actor_id text,p_user_id text,p_adjustment_id text,p_gold integer,p_xp integer,p_energy integer,p_streak integer,p_reason text
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_role text; v_balance user_economy%rowtype;
begin
  select role into v_role from profiles where id=p_actor_id;
  if v_role not in ('superadmin','admin') then raise exception 'Admin permission required'; end if;
  if v_role='admin' and not exists(
    select 1
    from admin_teacher_assignments ata
    join global_docs c on c.collection='teacher_classes' and c.data->>'teacherId'=ata.teacher_id
    join global_docs cm on cm.collection='teacher_class_members' and cm.data->>'classId'=c.doc_id
    where ata.admin_id=p_actor_id
      and cm.data->>'userId'=p_user_id
      and coalesce(cm.data->>'role','student')='student'
      and nullif(cm.data->>'kickedAt','') is null
  ) then
    raise exception 'Target user is outside the admin assigned classrooms';
  end if;
  if p_adjustment_id!~'^[A-Za-z0-9_-]{8,80}$' or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Adjustment reason is required'; end if;
  if abs(p_gold)>1000000 or abs(p_xp)>250000 or abs(p_energy)>10000 or abs(p_streak)>1000 then raise exception 'Adjustment exceeds safety limit'; end if;
  if v_role='admin' and (abs(p_gold)>10000 or abs(p_xp)>5000 or abs(p_energy)>100 or abs(p_streak)>30) then
    raise exception 'Admin adjustment exceeds classroom safety limit';
  end if;
  insert into user_economy(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_balance from user_economy where user_id=p_user_id for update;
  if exists(select 1 from economy_ledger where user_id=p_user_id and event_key='admin_adjust:'||p_adjustment_id) then
    return jsonb_build_object('applied',false,'balance',jsonb_build_object('gold',v_balance.gold,'xp',v_balance.global_xp,'energy',v_balance.energy,'gems',v_balance.gems,'streak',v_balance.streak));
  end if;
  if v_balance.gold+p_gold<0 or v_balance.global_xp+p_xp<0 or v_balance.energy+p_energy<0 or v_balance.streak+p_streak<0 then raise exception 'Adjustment would create a negative balance'; end if;
  update user_economy set gold=gold+p_gold,global_xp=global_xp+p_xp,energy=energy+p_energy,streak=streak+p_streak,updated_at=now() where user_id=p_user_id returning * into v_balance;
  insert into economy_ledger(user_id,event_key,event_type,source_id,gold_delta,xp_delta,energy_delta,gems_delta,streak_delta,balance_after,metadata)
  values(p_user_id,'admin_adjust:'||p_adjustment_id,'admin_adjustment',p_actor_id,p_gold,p_xp,p_energy,0,p_streak,jsonb_build_object('gold',v_balance.gold,'xp',v_balance.global_xp,'energy',v_balance.energy,'gems',v_balance.gems,'streak',v_balance.streak),jsonb_build_object('actorId',p_actor_id,'reason',trim(p_reason)));
  return jsonb_build_object('applied',true,'balance',jsonb_build_object('gold',v_balance.gold,'xp',v_balance.global_xp,'energy',v_balance.energy,'gems',v_balance.gems,'streak',v_balance.streak));
end;
$$;
revoke all on function economy_admin_adjust(text,text,text,integer,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function economy_admin_adjust(text,text,text,integer,integer,integer,integer,text) to service_role;

create or replace function economy_reconciliation_report(p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_role text; v_mismatches jsonb; v_untracked jsonb;
begin
  select role into v_role from profiles where id=p_actor_id;
  if v_role<>'superadmin' then raise exception 'Superadmin permission required'; end if;
  with latest as (
    select distinct on(user_id) user_id,balance_after,created_at from economy_ledger order by user_id,created_at desc,id desc
  ), differences as (
    select e.user_id,e.gold,e.global_xp,e.energy,e.gems,e.streak,l.balance_after,l.created_at
    from user_economy e join latest l on l.user_id=e.user_id
    where e.gold<>coalesce((l.balance_after->>'gold')::integer,e.gold)
       or e.global_xp<>coalesce((l.balance_after->>'xp')::integer,e.global_xp)
       or e.energy<>coalesce((l.balance_after->>'energy')::integer,e.energy)
       or e.gems<>coalesce((l.balance_after->>'gems')::integer,e.gems)
       or (l.balance_after ? 'streak' and e.streak<>(l.balance_after->>'streak')::integer)
  )
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'wallet',jsonb_build_object('gold',gold,'xp',global_xp,'energy',energy,'gems',gems,'streak',streak),'ledgerBalance',balance_after,'ledgerAt',created_at)),'[]'::jsonb) into v_mismatches from differences;
  select coalesce(jsonb_agg(jsonb_build_object('userId',e.user_id,'gold',e.gold,'xp',e.global_xp,'energy',e.energy,'gems',e.gems)),'[]'::jsonb) into v_untracked
  from user_economy e where not exists(select 1 from economy_ledger l where l.user_id=e.user_id);
  return jsonb_build_object('checkedAt',now(),'mismatchCount',jsonb_array_length(v_mismatches),'mismatches',v_mismatches,'untrackedWalletCount',jsonb_array_length(v_untracked),'untrackedWallets',v_untracked);
end;
$$;
revoke all on function economy_reconciliation_report(text) from public,anon,authenticated;
grant execute on function economy_reconciliation_report(text) to service_role;

insert into app_schema_migrations(migration_key,details)
values('economy_ledger_server_authority_v1',jsonb_build_object('description','Shared wallet ledger and server-authoritative economy actions'))
on conflict(migration_key) do update set applied_at=now(),details=excluded.details;

-- Preserve coins earned before the shared wallet rollout. The ledger key makes
-- this safe to run repeatedly; each legacy wallet is imported at most once.
-- The legacy document is retained as historical data and is no longer used by
-- the application after this migration.
do $$
declare
  v_legacy record;
  v_gold integer;
begin
  for v_legacy in
    select user_id, data
    from user_docs
    where collection = 'chrono_economy' and doc_id = 'global'
  loop
    if coalesce(v_legacy.data->>'gold', '') ~ '^\d+$' then
      v_gold := least((v_legacy.data->>'gold')::numeric, 10000000)::integer;
      if v_gold > 0 then
        perform economy_grant_event(
          v_legacy.user_id,
          'legacy_chrono_wallet_import:v1',
          'legacy_wallet_import',
          'chrono_economy/global',
          v_gold, 0, 0, 0,
          jsonb_build_object('migration', 'shared_wallet_v1', 'importedGold', v_gold)
        );
      end if;
    end if;
  end loop;
end;
$$;

-- Apply economy_wallet_lock_migration.sql only after this migration and the
-- matching API/web builds have passed staging verification.
