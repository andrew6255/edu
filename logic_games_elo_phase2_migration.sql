-- IQ Games: Elo rework, phase 2 (scoring and matchmaking).
-- Apply after logic_games_elo_phase1_migration.sql. Safe to rerun.
--
-- No top-level begin/commit on purpose: the Supabase SQL editor already wraps a
-- script in one transaction, and an inner commit would end it early.
--
-- Everything here runs server-side as the definer, because scoring is currently
-- done in the browser: the client computes an IQ delta and writes it straight to
-- logic_game_progress, so any student can set their own rating from the console.
-- After this, the client submits *what it answered*, never what it scored.

-- ─── Answer grading (mirrors artifacts/web-app/src/lib/interactionGrader.ts) ──
-- IQ Games questions only ever use mcq / numeric / text.

create or replace function logic_game_to_number(p_text text)
returns numeric language plpgsql immutable as $$
begin
  return trim(coalesce(p_text, ''))::numeric;
exception when others then
  return null;
end;
$$;

create or replace function logic_game_grade_answer(p_interaction jsonb, p_answer jsonb)
returns boolean language plpgsql immutable as $$
declare
  v_type text := p_interaction->>'type';
  v_kind text := p_answer->>'kind';
  v_submitted numeric;
  v_tolerance numeric;
  v_trim boolean;
  v_case_sensitive boolean;
  v_value text;
  v_candidate text;
begin
  if p_interaction is null or p_answer is null then return false; end if;

  if v_type = 'mcq' and v_kind = 'mcq' then
    return (p_answer->>'choiceIndex') is not null
       and (p_interaction->>'correctChoiceIndex') is not null
       and (p_answer->>'choiceIndex')::int = (p_interaction->>'correctChoiceIndex')::int;
  end if;

  if v_type = 'numeric' and v_kind = 'numeric' then
    v_submitted := logic_game_to_number(p_answer->>'valueText');
    if v_submitted is null then return false; end if;
    v_tolerance := coalesce(logic_game_to_number(p_interaction->>'tolerance'), 0);
    -- `correct` may be a scalar or an array of accepted values.
    return exists (
      select 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(p_interaction->'correct') = 'array'
             then p_interaction->'correct'
             else jsonb_build_array(p_interaction->'correct') end
      ) as t(candidate)
      where logic_game_to_number(t.candidate) is not null
        and (
          case when v_tolerance > 0
               then abs(v_submitted - logic_game_to_number(t.candidate)) <= v_tolerance
               else v_submitted = logic_game_to_number(t.candidate) end
        )
    );
  end if;

  if v_type = 'text' and v_kind = 'text' then
    -- trim defaults on, caseSensitive defaults off, matching the client.
    v_trim := coalesce((p_interaction->>'trim')::boolean, true);
    v_case_sensitive := coalesce((p_interaction->>'caseSensitive')::boolean, false);
    v_value := coalesce(p_answer->>'valueText', '');
    if v_trim then v_value := btrim(v_value); end if;
    if not v_case_sensitive then v_value := lower(v_value); end if;

    for v_candidate in
      select t.value from jsonb_array_elements_text(coalesce(p_interaction->'accepted', '[]'::jsonb)) as t(value)
    loop
      if v_trim then v_candidate := btrim(v_candidate); end if;
      if not v_case_sensitive then v_candidate := lower(v_candidate); end if;
      if v_candidate = v_value then return true; end if;
    end loop;
    return false;
  end if;

  return false;
end;
$$;

-- Strips the answer key so a question can be sent to the browser safely.
create or replace function logic_game_public_interaction(p_interaction jsonb)
returns jsonb language sql immutable as $$
  select case p_interaction->>'type'
    when 'mcq' then jsonb_build_object('type', 'mcq', 'choices', coalesce(p_interaction->'choices', '[]'::jsonb))
    when 'numeric' then jsonb_build_object('type', 'numeric')
    when 'text' then jsonb_build_object('type', 'text')
    else jsonb_build_object('type', coalesce(p_interaction->>'type', 'text'))
  end;
$$;

-- ─── Elo primitives ─────────────────────────────────────────────────────────
-- Scaling factor. Chess Elo uses 400 because its ratings span thousands of points;
-- this scale runs 70..160, so 400 would squeeze every possible matchup into a
-- 0.36..0.64 expected score and the ratings would stop discriminating. At 100, a
-- 100-point gap means roughly a 90% expected score, which fits an IQ range.
create or replace function logic_game_rating_divisor()
returns numeric language sql immutable as $$ select 100.0; $$;

create or replace function logic_game_expected_score(p_rating numeric, p_difficulty numeric)
returns numeric language sql immutable as $$
  select 1.0 / (1.0 + power(10.0, (p_difficulty - p_rating) / logic_game_rating_divisor()));
$$;

-- New players calibrate fast, established ones stop swinging on one lucky guess.
-- Sized against a ~90-point scale: chess K=32 moves a player ~3% of its range, and
-- these keep that proportion. Using chess's raw K here would move a new player a
-- quarter of the entire IQ scale on a single question.
create or replace function logic_game_user_k(p_answer_count integer)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_answer_count, 0) < 20 then 12.0   -- calibrating
    when p_answer_count < 100 then 6.0                -- settling
    else 3.0 end;                                     -- established
$$;

-- A question's rating locks in as the crowd proves how hard it really is.
create or replace function logic_game_question_k(p_play_count integer)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_play_count, 0) < 50 then 10.0
    when p_play_count < 500 then 5.0
    else 2.0 end;
$$;

-- Speed shapes the size of the swing, never its sign.
create or replace function logic_game_time_multiplier(p_correct boolean, p_time_ms integer, p_limit_sec integer)
returns numeric language plpgsql immutable as $$
declare v_ratio numeric;
begin
  if p_time_ms is null or coalesce(p_limit_sec, 0) <= 0 then return 1.0; end if;
  v_ratio := least(1.0, greatest(0.0, p_time_ms::numeric / (p_limit_sec * 1000.0)));
  if p_correct then
    return 1.25 - 0.45 * v_ratio;              -- 1.25 near-instant … 0.80 at the limit
  end if;
  if p_time_ms < 3000 then return 1.5; end if; -- answered wrong in under 3s: reckless guess
  if v_ratio >= 0.95 then return 0.8; end if;  -- used the whole clock and still missed
  return 1.0;
end;
$$;

-- ─── Submit an answer ───────────────────────────────────────────────────────
-- Takes what the student chose, not whether they were right. Grades, rates the
-- player and the question against each other, and records the answer, atomically.
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
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_mode not in ('iq', 'chill') then raise exception 'Invalid mode: %', p_mode; end if;

  -- Idempotent: a double-click or retry replays the original outcome and changes
  -- nothing, rather than erroring or scoring the same question twice.
  select * into v_prior from logic_game_answers
   where user_id = v_uid and node_id = p_node_id and question_id = p_question_id;
  if found then
    return jsonb_build_object(
      'alreadyAnswered', true, 'correct', v_prior.correct, 'mode', v_prior.mode,
      'iqBefore', v_prior.iq_before, 'iqAfter', v_prior.iq_after,
      'delta', coalesce(v_prior.iq_after, 0) - coalesce(v_prior.iq_before, 0)
    );
  end if;

  select * into v_q from logic_game_questions_public
   where node_id = p_node_id and question_id = p_question_id
   for update;
  if not found then raise exception 'Question not found'; end if;

  v_correct := logic_game_grade_answer(v_q.interaction, p_answer);

-- floor_iq is deliberately omitted: it still has a default before the phase 3
  -- cleanup, and does not exist after it. Naming it would break this RPC once the
  -- column is dropped.
  insert into logic_game_progress (user_id, iq) values (v_uid, 80)
    on conflict (user_id) do nothing;
  select iq, peak_iq into v_iq, v_peak from logic_game_progress where user_id = v_uid for update;

  -- Chill mode consumes the question but moves no ratings, on either side.
  if p_mode = 'chill' then
    insert into logic_game_answers (user_id, node_id, question_id, mode, correct, time_ms)
      values (v_uid, p_node_id, p_question_id, 'chill', v_correct, p_time_ms);
    return jsonb_build_object(
      'alreadyAnswered', false, 'correct', v_correct, 'mode', 'chill',
      'iqBefore', v_iq, 'iqAfter', v_iq, 'delta', 0, 'peakIq', v_peak
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

  update logic_game_questions_public
     set difficulty = v_difficulty_new,
         play_count = play_count + 1,
         correct_count = correct_count + (case when v_correct then 1 else 0 end)
   where id = v_q.id;

  update logic_game_progress
     set iq = v_iq_new,
         peak_iq = greatest(coalesce(peak_iq, 80), v_iq_new),
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
    'difficultyAfter', v_difficulty_new
  );
end;
$$;

-- ─── Serve the next question ────────────────────────────────────────────────
-- Targets a question the student should beat roughly 65-75% of the time, on a
-- four-question rhythm, never repeating one they have already seen in either mode.
create or replace function logic_game_next_question(p_mode text default 'iq')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
  v_iq numeric;
  v_seen integer;
  v_target numeric;
  v_row record;
  v_step integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

-- floor_iq is deliberately omitted: it still has a default before the phase 3
  -- cleanup, and does not exist after it. Naming it would break this RPC once the
  -- column is dropped.
  insert into logic_game_progress (user_id, iq) values (v_uid, 80)
    on conflict (user_id) do nothing;
  select iq into v_iq from logic_game_progress where user_id = v_uid;
  select count(*) into v_seen from logic_game_answers where user_id = v_uid;

  -- Matching a student to their exact rating means losing half the time, which
  -- reads as punishing. Aim below it, with one harder "boss" question in four.
  -- Offsets are in IQ points and derived from the divisor above, not copied from
  -- chess: at divisor 100, -48 gives ~75%, -27 gives ~65%, +18 gives ~40%.
  v_target := v_iq + case (v_seen % 4)
    when 0 then -48.0   -- confidence builder (~75%)
    when 1 then -27.0   -- standard (~65%)
    when 2 then -27.0   -- standard (~65%)
    else         18.0   -- boss (~40%)
  end;

  -- Widen the band until something unseen turns up.
  for v_step in 0..11 loop
    select q.* into v_row
      from logic_game_questions_public q
     where q.difficulty between v_target - (15.0 + v_step * 15.0)
                            and v_target + (15.0 + v_step * 15.0)
       and not exists (
         select 1 from logic_game_answers a
          where a.user_id = v_uid and a.node_id = q.node_id and a.question_id = q.question_id
       )
     order by random()
     limit 1;
    exit when found;
  end loop;

  -- Nothing in range: take anything unseen rather than stalling the session.
  if v_row.question_id is null then
    select q.* into v_row
      from logic_game_questions_public q
     where not exists (
       select 1 from logic_game_answers a
        where a.user_id = v_uid and a.node_id = q.node_id and a.question_id = q.question_id
     )
     order by random()
     limit 1;
  end if;

  -- Genuinely out of content. Never-repeat makes this reachable, so the UI has to
  -- handle it rather than treat it as an error.
  if v_row.question_id is null then
    return jsonb_build_object('exhausted', true);
  end if;

  return jsonb_build_object(
    'exhausted', false,
    'nodeId', v_row.node_id,
    'questionId', v_row.question_id,
    'promptBlocks', v_row.prompt_blocks,
    'promptRawText', v_row.prompt_raw_text,
    'promptLatex', v_row.prompt_latex,
    'timeLimitSec', v_row.time_limit_sec,
    -- Answer key stripped: the browser never receives it.
    'interaction', logic_game_public_interaction(v_row.interaction)
  );
end;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
revoke all on function logic_game_submit_answer(text, text, jsonb, integer, text) from public, anon;
revoke all on function logic_game_next_question(text) from public, anon;
grant execute on function logic_game_submit_answer(text, text, jsonb, integer, text) to authenticated;
grant execute on function logic_game_next_question(text) to authenticated;

-- ─── Verification ───────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.logic_game_submit_answer(text,text,jsonb,integer,text)') is null
     or to_regprocedure('public.logic_game_next_question(text)') is null then
    raise exception 'Elo phase 2 RPCs are missing';
  end if;

  -- Grading sanity: right answer accepted, wrong answer rejected, answer key hidden.
  if not logic_game_grade_answer(
      '{"type":"mcq","choices":["a","b","c","d"],"correctChoiceIndex":2}'::jsonb,
      '{"kind":"mcq","choiceIndex":2}'::jsonb) then
    raise exception 'grader rejected a correct mcq answer';
  end if;
  if logic_game_grade_answer(
      '{"type":"mcq","choices":["a","b","c","d"],"correctChoiceIndex":2}'::jsonb,
      '{"kind":"mcq","choiceIndex":1}'::jsonb) then
    raise exception 'grader accepted a wrong mcq answer';
  end if;
  if (logic_game_public_interaction(
      '{"type":"mcq","choices":["a","b"],"correctChoiceIndex":1}'::jsonb) ? 'correctChoiceIndex') then
    raise exception 'sanitized interaction still leaks the answer key';
  end if;
end;
$$;
