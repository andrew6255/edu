-- IQ Games: Elo rework, phase 5 — cognitive metrics.
--
-- Adds the 7-metric "Cognitive & IQ Metric Profile" framework: every question
-- can be tagged with one primary metric (worth 10pts on a correct answer) and
-- up to two secondary metrics (5pts each), and a student's running per-metric
-- totals ("mental profile") accumulate on logic_game_progress the same way
-- profiles.arena_stats already accumulates arena results — read-merge-write a
-- small named-key jsonb counter, no new table.
--
-- Also carries `explanation` (a short whole-question explanation, used for
-- non-MCQ types and as a fallback) and, for MCQ, a `choiceExplanations` array
-- nested inside the existing `interaction` jsonb (same order as `choices`) so
-- each option can explain briefly why it's right or wrong. Neither of these
-- previously had a column to land in — the superadmin UI already collected
-- them but every save silently discarded them.
--
-- Safe to rerun. No top-level begin/commit: the Supabase SQL editor already
-- wraps a script in one transaction.

do $$
begin
  if to_regprocedure('public.logic_game_submit_answer(text,text,jsonb,integer,text)') is null then
    raise exception 'Run logic_games_elo_phase2_migration.sql before this migration';
  end if;
end;
$$;

-- ─── The 7 metric slugs ─────────────────────────────────────────────────────

create or replace function logic_game_metric_slugs()
returns text[] language sql immutable as $$
  select array[
    'spatial_imagination', 'fluid_patterning', 'deductive_logic',
    'quantitative_abstraction', 'working_memory', 'strategic_optimization',
    'visual_perceptual_precision'
  ];
$$;

-- ─── Question columns: explanation + metric tags ───────────────────────────

alter table logic_game_questions_public
  add column if not exists explanation text,
  add column if not exists primary_metric text,
  add column if not exists secondary_metrics text[] not null default '{}';

alter table logic_game_questions_draft
  add column if not exists explanation text,
  add column if not exists primary_metric text,
  add column if not exists secondary_metrics text[] not null default '{}';

do $$
declare
  v_table text;
begin
  foreach v_table in array array['logic_game_questions_public', 'logic_game_questions_draft'] loop
    execute format('alter table %I drop constraint if exists %I', v_table, v_table || '_primary_metric_check');
    execute format(
      'alter table %I add constraint %I check (primary_metric is null or primary_metric = any(logic_game_metric_slugs()))',
      v_table, v_table || '_primary_metric_check'
    );
    execute format('alter table %I drop constraint if exists %I', v_table, v_table || '_secondary_metrics_check');
    execute format(
      'alter table %I add constraint %I check (' ||
        'coalesce(array_length(secondary_metrics, 1), 0) <= 2' ||
        ' and secondary_metrics <@ logic_game_metric_slugs()' ||
        ' and (primary_metric is null or not (primary_metric = any(secondary_metrics)))' ||
      ')',
      v_table, v_table || '_secondary_metrics_check'
    );
  end loop;
end;
$$;

-- ─── Student mental profile ─────────────────────────────────────────────────
-- Keyed by the 7 metric slugs -> accumulated points. Mirrors profiles.arena_stats.

alter table logic_game_progress
  add column if not exists mental_profile jsonb not null default '{}'::jsonb;

-- ─── logic_game_submit_answer: return explanation/interaction, score metrics ─
-- `v_q` is now selected once, before branching on whether this is a replay, so
-- both the idempotent-replay path and the real scoring path can return the
-- question's explanation/interaction (safe to reveal — the student has, by
-- definition, already answered by the time either branch is reached).

create or replace function logic_game_submit_answer(
  p_node_id text,
  p_question_id text,
  p_answer jsonb,
  p_time_ms integer default null,
  p_mode text default 'iq'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_q record;
  v_prior logic_game_answers%rowtype;
  v_correct boolean;
  v_iq numeric; v_peak numeric;
  v_expected numeric; v_choices integer;
  v_k numeric; v_kq numeric; v_multiplier numeric; v_raw_delta numeric;
  v_iq_new numeric; v_difficulty_new numeric;
  v_answer_count integer;
  v_score numeric;
  v_mental_profile jsonb;
  v_metric_delta jsonb;
  v_metric_key text;
  v_metric_val numeric;
  v_new_profile jsonb;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_mode not in ('iq', 'chill') then raise exception 'Invalid mode: %', p_mode; end if;

  select * into v_prior from logic_game_answers
   where user_id = v_uid and node_id = p_node_id and question_id = p_question_id;

  select * into v_q from logic_game_questions_public
   where node_id = p_node_id and question_id = p_question_id
   for update;
  if not found then raise exception 'Question not found'; end if;

  -- Idempotent: a double-click or retry replays the original outcome and changes
  -- nothing, rather than erroring or scoring the same question twice.
  if v_prior.user_id is not null then
    return jsonb_build_object(
      'alreadyAnswered', true, 'correct', v_prior.correct, 'mode', v_prior.mode,
      'iqBefore', v_prior.iq_before, 'iqAfter', v_prior.iq_after,
      'delta', coalesce(v_prior.iq_after, 0) - coalesce(v_prior.iq_before, 0),
      'explanation', v_q.explanation, 'interaction', v_q.interaction
    );
  end if;

  v_correct := logic_game_grade_answer(v_q.interaction, p_answer);

  -- floor_iq is deliberately omitted: it still has a default before the phase 3
  -- cleanup, and does not exist after it. Naming it would break this RPC once the
  -- column is dropped.
  insert into logic_game_progress (user_id, iq) values (v_uid, 80)
    on conflict (user_id) do nothing;
  select iq, peak_iq, mental_profile into v_iq, v_peak, v_mental_profile
    from logic_game_progress where user_id = v_uid for update;

  -- Chill mode consumes the question but moves no ratings, and scores no
  -- metrics, on either side — a zero-stakes practice pass.
  if p_mode = 'chill' then
    insert into logic_game_answers (user_id, node_id, question_id, mode, correct, time_ms)
      values (v_uid, p_node_id, p_question_id, 'chill', v_correct, p_time_ms);
    return jsonb_build_object(
      'alreadyAnswered', false, 'correct', v_correct, 'mode', 'chill',
      'iqBefore', v_iq, 'iqAfter', v_iq, 'delta', 0, 'peakIq', v_peak,
      'explanation', v_q.explanation, 'interaction', v_q.interaction
    );
  end if;

  select count(*) into v_answer_count from logic_game_answers where user_id = v_uid and mode = 'iq';

  v_expected := logic_game_expected_score(v_iq, v_q.difficulty);
  -- Guessing floor: on a 4-option question you score 25% blindfolded, so a miss has
  -- to cost something even when the question is far above your rating.
  if v_q.interaction->>'type' = 'mcq' then
    v_choices := coalesce(jsonb_array_length(v_q.interaction->'choices'), 0);
    if v_choices > 0 then
      v_expected := greatest(v_expected, 1.0 / v_choices);
    end if;
  end if;

  v_score := case when v_correct then 1.0 else 0.0 end;
  v_k := logic_game_user_k(v_answer_count);
  v_multiplier := logic_game_time_multiplier(v_correct, p_time_ms, v_q.time_limit_sec);

  -- K is defined as the most a single question may ever move a rating. The time
  -- multiplier shapes the swing *within* that budget; without this clamp a fast
  -- correct answer (x1.25) or a reckless wrong one (x1.5) would silently score
  -- above the K-factor, so a new player could move 60 points on one question.
  v_raw_delta := v_k * (v_score - v_expected) * v_multiplier;
  v_raw_delta := greatest(-v_k, least(v_k, v_raw_delta));

  v_iq_new := round(least(160.0, greatest(70.0, v_iq + v_raw_delta)), 2);

  -- The question plays the other side of the same match: it "wins" when the
  -- student is wrong. No time multiplier — how fast someone answered says something
  -- about the player, not about how hard the item is.
  v_kq := logic_game_question_k(v_q.play_count);
  v_difficulty_new := round(least(170.0, greatest(60.0,
    v_q.difficulty + v_kq * ((1.0 - v_score) - (1.0 - v_expected)))), 2);

  -- Mental profile: primary metric earns 10pts, each secondary metric 5pts,
  -- only on a correct ranked answer, only for questions that were actually
  -- tagged (untagged legacy questions score nothing rather than erroring).
  v_new_profile := coalesce(v_mental_profile, '{}'::jsonb);
  if v_correct and v_q.primary_metric is not null then
    v_metric_delta := jsonb_build_object(v_q.primary_metric, 10);
    if v_q.secondary_metrics is not null then
      foreach v_metric_key in array v_q.secondary_metrics loop
        v_metric_delta := v_metric_delta || jsonb_build_object(
          v_metric_key, coalesce((v_metric_delta->>v_metric_key)::numeric, 0) + 5
        );
      end loop;
    end if;
    for v_metric_key, v_metric_val in select key, value::numeric from jsonb_each_text(v_metric_delta) loop
      v_new_profile := jsonb_set(
        v_new_profile, array[v_metric_key],
        to_jsonb(coalesce((v_new_profile->>v_metric_key)::numeric, 0) + v_metric_val)
      );
    end loop;
  end if;

  update logic_game_questions_public
     set difficulty = v_difficulty_new,
         play_count = play_count + 1,
         correct_count = correct_count + (case when v_correct then 1 else 0 end)
   where id = v_q.id;

  update logic_game_progress
     set iq = v_iq_new,
         peak_iq = greatest(coalesce(peak_iq, 80), v_iq_new),
         mental_profile = v_new_profile,
         updated_at = now()
   where user_id = v_uid
   returning peak_iq into v_peak;

  insert into logic_game_answers (
    user_id, node_id, question_id, mode, correct, time_ms,
    iq_before, iq_after, difficulty_before, difficulty_after
  ) values (
    v_uid, p_node_id, p_question_id, 'iq', v_correct, p_time_ms,
    v_iq, v_iq_new, v_q.difficulty, v_difficulty_new
  );

  return jsonb_build_object(
    'alreadyAnswered', false,
    'correct', v_correct,
    'mode', 'iq',
    'iqBefore', v_iq,
    'iqAfter', v_iq_new,
    -- The applied delta, after clamping, so the UI can never show a change that
    -- did not actually happen.
    'delta', round(v_iq_new - v_iq, 2),
    'peakIq', v_peak,
    'expected', round(v_expected, 4),
    'difficultyBefore', v_q.difficulty,
    'difficultyAfter', v_difficulty_new,
    'explanation', v_q.explanation,
    'interaction', v_q.interaction,
    'mentalProfile', v_new_profile
  );
end;
$$;

revoke all on function logic_game_submit_answer(text, text, jsonb, integer, text) from public, anon;
grant execute on function logic_game_submit_answer(text, text, jsonb, integer, text) to authenticated;

-- ─── Verification ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logic_game_questions_public' and column_name = 'primary_metric'
  ) then
    raise exception 'phase 5 did not add primary_metric to logic_game_questions_public';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logic_game_progress' and column_name = 'mental_profile'
  ) then
    raise exception 'phase 5 did not add mental_profile to logic_game_progress';
  end if;
  if array_length(logic_game_metric_slugs(), 1) != 7 then
    raise exception 'logic_game_metric_slugs() does not return exactly 7 slugs';
  end if;
end;
$$;
