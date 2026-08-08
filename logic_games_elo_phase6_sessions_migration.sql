-- IQ Games: Elo rework, phase 6 — persistent sessions.
--
-- Until now a "10 question session" existed only as React state in
-- LogicGamesView — it vanished the moment a student navigated away or
-- refreshed, so there was no way to resume an abandoned session and no
-- history of past sessions. This adds a real `logic_game_sessions` row per
-- 10-question run, auto-opened by the first iq-mode answer and auto-closed
-- once `target_length` answers land, so the server is the sole authority on
-- session progress the same way it already is for rating and mental-profile
-- scoring (see phase2/phase5). Chill mode is untouched: it already returns
-- before any of this runs, by design.
--
-- Safe to rerun. No top-level begin/commit: the Supabase SQL editor already
-- wraps a script in one transaction.

do $$
begin
  if to_regprocedure('public.logic_game_submit_answer(text,text,jsonb,integer,text)') is null then
    raise exception 'Run logic_games_elo_phase5_cognitive_metrics_migration.sql before this migration';
  end if;
end;
$$;

-- ─── Sessions table ─────────────────────────────────────────────────────────

create table if not exists logic_game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  status text not null check (status in ('in_progress', 'completed')) default 'in_progress',
  target_length integer not null default 10,
  answered_count integer not null default 0,
  correct_count integer not null default 0,
  iq_before numeric not null,
  iq_after numeric,
  mental_profile_delta jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- The invariant the whole feature leans on: at most one open session per
-- user, so logic_game_submit_answer can always find "the" session to credit
-- without the client ever having to pass a session id.
create unique index if not exists logic_game_sessions_one_in_progress
  on logic_game_sessions(user_id) where status = 'in_progress';

create index if not exists idx_logic_game_sessions_user_started
  on logic_game_sessions(user_id, started_at desc);

alter table logic_game_sessions enable row level security;

-- Read your own sessions. Writes go exclusively through the security-definer
-- RPC below, same as logic_game_answers (phase1) and logic_game_progress.
drop policy if exists logic_game_sessions_select_own on logic_game_sessions;
create policy logic_game_sessions_select_own on logic_game_sessions
for select to authenticated
using (user_id = auth.uid()::text);

revoke all on logic_game_sessions from public, anon, authenticated;
grant select on logic_game_sessions to authenticated;

-- ─── logic_game_submit_answer: open/advance/complete the session ───────────

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
  v_session logic_game_sessions%rowtype;
  v_session_new_profile jsonb;
  v_session_complete boolean;
  v_recent_session logic_game_sessions%rowtype;
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
  -- nothing, rather than erroring or scoring the same question twice. Best-effort
  -- report of whatever session this answer belonged to, for a client retry to
  -- stay in sync — answers from before this feature existed simply have none.
  if v_prior.user_id is not null then
    select * into v_recent_session from logic_game_sessions
     where user_id = v_uid order by started_at desc limit 1;
    return jsonb_build_object(
      'alreadyAnswered', true, 'correct', v_prior.correct, 'mode', v_prior.mode,
      'iqBefore', v_prior.iq_before, 'iqAfter', v_prior.iq_after,
      'delta', coalesce(v_prior.iq_after, 0) - coalesce(v_prior.iq_before, 0),
      'explanation', v_q.explanation, 'interaction', v_q.interaction,
      'sessionId', v_recent_session.id, 'sessionAnsweredCount', v_recent_session.answered_count,
      'sessionTargetLength', v_recent_session.target_length,
      'sessionComplete', v_recent_session.status = 'completed'
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

  -- Chill mode consumes the question but moves no ratings, scores no metrics,
  -- and opens no session — a zero-stakes practice pass, entirely separate
  -- from the 10-question iq-mode session concept below.
  if p_mode = 'chill' then
    insert into logic_game_answers (user_id, node_id, question_id, mode, correct, time_ms)
      values (v_uid, p_node_id, p_question_id, 'chill', v_correct, p_time_ms);
    return jsonb_build_object(
      'alreadyAnswered', false, 'correct', v_correct, 'mode', 'chill',
      'iqBefore', v_iq, 'iqAfter', v_iq, 'delta', 0, 'peakIq', v_peak,
      'explanation', v_q.explanation, 'interaction', v_q.interaction
    );
  end if;

  -- Sessions: group consecutive iq-mode answers into rounds of `target_length`
  -- (10 today). The partial unique index above guarantees at most one open
  -- session per user, so the first answer after none is open silently opens
  -- one - the client never explicitly "starts" a session, and leaving mid-way
  -- (navigate away, refresh, close the tab) simply leaves it in_progress for
  -- a later answer to pick back up.
  insert into logic_game_sessions (user_id, iq_before)
    select v_uid, v_iq
     where not exists (
       select 1 from logic_game_sessions where user_id = v_uid and status = 'in_progress'
     );

  select * into v_session from logic_game_sessions
   where user_id = v_uid and status = 'in_progress'
   for update;

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
  -- The same delta feeds both the lifetime total (logic_game_progress) and
  -- this session's own running total (logic_game_sessions), so the post-
  -- session summary can show exactly what was earned in this round alone.
  v_new_profile := coalesce(v_mental_profile, '{}'::jsonb);
  v_session_new_profile := coalesce(v_session.mental_profile_delta, '{}'::jsonb);
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
      v_session_new_profile := jsonb_set(
        v_session_new_profile, array[v_metric_key],
        to_jsonb(coalesce((v_session_new_profile->>v_metric_key)::numeric, 0) + v_metric_val)
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

  v_session_complete := (v_session.answered_count + 1) >= v_session.target_length;

  update logic_game_sessions
     set answered_count = v_session.answered_count + 1,
         correct_count = v_session.correct_count + (case when v_correct then 1 else 0 end),
         mental_profile_delta = v_session_new_profile,
         iq_after = v_iq_new,
         status = case when v_session_complete then 'completed' else 'in_progress' end,
         completed_at = case when v_session_complete then now() else null end,
         updated_at = now()
   where id = v_session.id;

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
    'mentalProfile', v_new_profile,
    'sessionId', v_session.id,
    'sessionAnsweredCount', v_session.answered_count + 1,
    'sessionTargetLength', v_session.target_length,
    'sessionComplete', v_session_complete,
    'sessionMentalProfileDelta', v_session_new_profile
  );
end;
$$;

revoke all on function logic_game_submit_answer(text, text, jsonb, integer, text) from public, anon;
grant execute on function logic_game_submit_answer(text, text, jsonb, integer, text) to authenticated;

-- ─── Verification ───────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.logic_game_sessions') is null then
    raise exception 'phase 6 did not create logic_game_sessions';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'logic_game_sessions'
      and indexname = 'logic_game_sessions_one_in_progress'
  ) then
    raise exception 'phase 6 did not create the one-in-progress-session-per-user index';
  end if;
end;
$$;
