-- IQ Games: Elo rework, phase 4 tuning.
--
-- Testing feedback: a correct answer on a well-matched question was moving a
-- new player's IQ by several points in one shot (K=12 at expected~0.65 gives
-- delta ~4). That's too coarse for a slow-building rating meant to invite many
-- more questions, not race to a number. This tunes both K-factor tables down
-- by roughly 10x, landing a matched-difficulty correct answer around 0.2-0.4
-- for a new player and smaller once established, while leaving the expected-
-- score formula, time multiplier, MCQ guessing floor, matchmaking offsets, and
-- IQ/difficulty clamps from phase2 untouched. The ~1.2:1 ratio between player-K
-- and question-K is preserved so the two sides keep calibrating at the same
-- relative pace as before.
--
-- Safe to rerun. No top-level begin/commit: the Supabase SQL editor already
-- wraps a script in one transaction.

do $$
begin
  if to_regprocedure('public.logic_game_user_k(integer)') is null
     or to_regprocedure('public.logic_game_question_k(integer)') is null then
    raise exception 'Run logic_games_elo_phase2_migration.sql before this tuning pass';
  end if;
end;
$$;

create or replace function logic_game_user_k(p_answer_count integer)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_answer_count, 0) < 20 then 1.2   -- calibrating
    when p_answer_count < 100 then 0.6                -- settling
    else 0.3 end;                                     -- established
$$;

create or replace function logic_game_question_k(p_play_count integer)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_play_count, 0) < 50 then 1.0
    when p_play_count < 500 then 0.5
    else 0.2 end;
$$;
