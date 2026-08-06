-- IQ Games: Elo rework, phase 3 cleanup.
--
-- RUN THIS ONLY AFTER the new IQ Games UI is deployed and verified.
--
-- Until then the live web app still writes logic_game_progress.floor_iq and reads
-- logic_game_nodes_public.iq to draw the level map, so dropping either column
-- early breaks scoring and the games screen for anyone on the old build. This is
-- the one migration in the set that is NOT safe to run ahead of the frontend.
--
-- Safe to rerun. No top-level begin/commit: the Supabase SQL editor already wraps
-- a script in one transaction.

-- Refuse to run if the phases it depends on have not been applied.
do $$
begin
  if to_regprocedure('public.logic_game_submit_answer(text,text,jsonb,integer,text)') is null then
    raise exception 'Run logic_games_elo_phase2_migration.sql before this cleanup';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logic_game_progress' and column_name = 'peak_iq'
  ) then
    raise exception 'Run logic_games_elo_phase1_migration.sql before this cleanup';
  end if;
end;
$$;

-- The ratcheting floor is what made ratings inflate until matchmaking stopped
-- discriminating. peak_iq replaced it as a cosmetic badge that never feeds the math.
alter table logic_game_progress drop column if exists floor_iq;

-- Buckets have no threshold. `iq` was the old level gate; seed_difficulty replaced it.
alter table logic_game_nodes_public drop column if exists iq;
alter table logic_game_nodes_draft  drop column if exists iq;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'logic_game_progress' and column_name = 'floor_iq')
        or (table_name in ('logic_game_nodes_public', 'logic_game_nodes_draft') and column_name = 'iq'))
  ) then
    raise exception 'cleanup did not remove the deprecated columns';
  end if;
end;
$$;
