-- IQ Games: Elo rework, phase 1 (schema only).
-- Apply after supabase_schema.sql and logic_games_superadmin_rls_migration.sql.
-- Safe to rerun.
--
-- This phase only reshapes data. The scoring and matchmaking RPCs land in phase 2,
-- so nothing here changes gameplay yet and the currently deployed web app keeps
-- working against it unchanged.
--
-- Deliberately contains no top-level begin/commit: the Supabase SQL editor already
-- wraps a script in one transaction, and an inner commit would end it early and
-- defeat that safety net.
--
-- What changes:
--   * Levels become buckets. A bucket is an authoring aid only — it sets the
--     starting difficulty of questions filed into it and has no threshold, no
--     unlock gate, and no student-facing meaning.
--   * Questions carry their own self-calibrating Elo difficulty.
--   * A user's rating becomes fractional and may fall; `peak_iq` remembers the best.
--   * Every answer is recorded once, permanently, so a student can never be shown
--     the same question twice in either mode.

-- ─── Buckets (formerly levels) ──────────────────────────────────────────────
-- `iq` is left in place for now: the deployed web app still reads it to draw the
-- level map. It is dropped in the phase 3 cleanup, after the new UI ships.
alter table logic_game_nodes_public add column if not exists seed_difficulty numeric;
alter table logic_game_nodes_draft  add column if not exists seed_difficulty numeric;

-- Backfilled from the old level threshold, but only while that column still
-- exists: the phase 3 cleanup drops `iq`, and this file must stay rerunnable
-- afterwards rather than failing with "column iq does not exist".
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'logic_game_nodes_public' and column_name = 'iq') then
    execute 'update logic_game_nodes_public set seed_difficulty = iq where seed_difficulty is null';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'logic_game_nodes_draft' and column_name = 'iq') then
    execute 'update logic_game_nodes_draft set seed_difficulty = iq where seed_difficulty is null';
  end if;
end;
$$;

update logic_game_nodes_public set seed_difficulty = 100 where seed_difficulty is null;
update logic_game_nodes_draft  set seed_difficulty = 100 where seed_difficulty is null;

alter table logic_game_nodes_public alter column seed_difficulty set default 100;
alter table logic_game_nodes_draft  alter column seed_difficulty set default 100;
alter table logic_game_nodes_public alter column seed_difficulty set not null;
alter table logic_game_nodes_draft  alter column seed_difficulty set not null;

-- Starter buckets, only when none exist yet (a fresh install). An existing install
-- keeps its authored levels, which became buckets via the backfill above.
do $$
begin
  if not exists (select 1 from logic_game_nodes_public) then
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'logic_game_nodes_public' and column_name = 'iq') then
      execute $ins$
        insert into logic_game_nodes_public (id, iq, label, seed_difficulty, sort_order) values
          ('bucket-very-easy', 75,  'Very Easy', 75,  1),
          ('bucket-easy',      85,  'Easy',      85,  2),
          ('bucket-medium',    100, 'Medium',    100, 3),
          ('bucket-hard',      115, 'Hard',      115, 4),
          ('bucket-very-hard', 130, 'Very Hard', 130, 5),
          ('bucket-expert',    145, 'Expert',    145, 6)
      $ins$;
    else
      insert into logic_game_nodes_public (id, label, seed_difficulty, sort_order) values
        ('bucket-very-easy', 'Very Easy', 75,  1),
        ('bucket-easy',      'Easy',      85,  2),
        ('bucket-medium',    'Medium',    100, 3),
        ('bucket-hard',      'Hard',      115, 4),
        ('bucket-very-hard', 'Very Hard', 130, 5),
        ('bucket-expert',    'Expert',    145, 6);
    end if;
  end if;
end;
$$;

-- ─── Question difficulty ────────────────────────────────────────────────────
alter table logic_game_questions_public
  add column if not exists difficulty numeric,
  add column if not exists play_count integer not null default 0,
  add column if not exists correct_count integer not null default 0;

alter table logic_game_questions_draft
  add column if not exists difficulty numeric,
  add column if not exists play_count integer not null default 0,
  add column if not exists correct_count integer not null default 0;

-- Cold start: a question inherits its bucket's seed rating, then self-calibrates.
update logic_game_questions_public q
   set difficulty = n.seed_difficulty
  from logic_game_nodes_public n
 where n.id = q.node_id and q.difficulty is null;

update logic_game_questions_draft q
   set difficulty = n.seed_difficulty
  from logic_game_nodes_draft n
 where n.id = q.node_id and q.difficulty is null;

update logic_game_questions_public set difficulty = 100 where difficulty is null;
update logic_game_questions_draft  set difficulty = 100 where difficulty is null;

alter table logic_game_questions_public alter column difficulty set default 100;
alter table logic_game_questions_draft  alter column difficulty set default 100;
alter table logic_game_questions_public alter column difficulty set not null;
alter table logic_game_questions_draft  alter column difficulty set not null;

-- Matchmaking searches a difficulty band within the unanswered pool.
create index if not exists idx_logic_game_questions_public_difficulty
  on logic_game_questions_public(difficulty);

-- ─── User rating ────────────────────────────────────────────────────────────
-- Elo produces fractional ratings; the column is integer today. Guarded so the
-- file stays rerunnable (an unconditional ALTER TYPE fails once policies exist).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logic_game_progress'
      and column_name = 'iq' and data_type <> 'numeric'
  ) then
    alter table logic_game_progress alter column iq type numeric using iq::numeric;
  end if;
end;
$$;

-- Cosmetic "highest ever reached" badge. Defaults to the 80 baseline rather than
-- 100 so a new player is never shown a peak they did not earn.
alter table logic_game_progress add column if not exists peak_iq numeric not null default 80;
update logic_game_progress set peak_iq = greatest(coalesce(peak_iq, 80), iq, 80);

-- `floor_iq` is intentionally NOT dropped here. The live web app still writes it,
-- so removing it now would break scoring for anyone on the current build. It stops
-- being read in phase 2 and is dropped in phase 3. Its ratcheting behaviour is what
-- made ratings inflate and matchmaking degrade, so nothing may depend on it again.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'logic_game_progress' and column_name = 'floor_iq') then
    execute $c$comment on column logic_game_progress.floor_iq is
      'Deprecated ratchet floor. Unused from Elo phase 2; dropped in phase 3. Do not read.'$c$;
  end if;
end;
$$;

-- ─── Answer history ─────────────────────────────────────────────────────────
-- One row per user per question, forever. The unique constraint is what actually
-- guarantees a student never sees a question twice — in IQ mode or chill mode —
-- rather than leaving it to query logic that could regress.
--
-- The key includes node_id because question_id is only unique *within* a bucket
-- (logic_game_questions_public is unique on (node_id, question_id), and the admin
-- upserts on that pair). Keying on question_id alone would let an answer in one
-- bucket permanently hide an unrelated question that happens to share its id in
-- another bucket.
create table if not exists logic_game_answers (
  id bigint generated always as identity primary key,
  user_id text not null references profiles(id) on delete cascade,
  node_id text not null,
  question_id text not null,
  mode text not null check (mode in ('iq', 'chill')),
  correct boolean not null,
  time_ms integer,
  -- Null for chill answers: they change no ratings, but still consume the question.
  iq_before numeric,
  iq_after numeric,
  difficulty_before numeric,
  difficulty_after numeric,
  created_at timestamptz not null default now(),
  unique (user_id, node_id, question_id)
);

-- Repairs installs that ran an earlier revision of this file, which keyed the
-- constraint on (user_id, question_id) alone.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'logic_game_answers'::regclass
      and conname = 'logic_game_answers_user_id_question_id_key'
  ) then
    alter table logic_game_answers drop constraint logic_game_answers_user_id_question_id_key;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'logic_game_answers'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, node_id, question_id)'
  ) then
    alter table logic_game_answers add unique (user_id, node_id, question_id);
  end if;
end;
$$;

create index if not exists idx_logic_game_answers_user on logic_game_answers(user_id);
create index if not exists idx_logic_game_answers_question on logic_game_answers(node_id, question_id);

alter table logic_game_answers enable row level security;

-- Read your own history. Writes go exclusively through the phase 2 security-definer
-- RPC, so there is deliberately no insert/update/delete policy: a client cannot
-- fabricate an answer, award itself rating, or erase a question it has already seen.
drop policy if exists logic_game_answers_select_own on logic_game_answers;
create policy logic_game_answers_select_own on logic_game_answers
for select to authenticated
using (user_id = auth.uid()::text);

-- Defense in depth against Supabase's default grants, which hand ALL privileges on
-- new objects in `public` to the client roles.
revoke all on logic_game_answers from public, anon, authenticated;
grant select on logic_game_answers to authenticated;

-- ─── Verification ───────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing from (
    select 'logic_game_nodes_public.seed_difficulty' as c
      where to_regclass('public.logic_game_nodes_public') is not null
        and not exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='logic_game_nodes_public' and column_name='seed_difficulty')
    union all
    select 'logic_game_questions_public.difficulty'
      where not exists (select 1 from information_schema.columns
        where table_schema='public' and table_name='logic_game_questions_public' and column_name='difficulty')
    union all
    select 'logic_game_progress.peak_iq'
      where not exists (select 1 from information_schema.columns
        where table_schema='public' and table_name='logic_game_progress' and column_name='peak_iq')
    union all
    select 'logic_game_answers'
      where to_regclass('public.logic_game_answers') is null
  ) t;

  if v_missing is not null then
    raise exception 'Elo phase 1 incomplete, missing: %', v_missing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='logic_game_progress'
      and column_name='iq' and data_type <> 'numeric'
  ) then
    raise exception 'logic_game_progress.iq is still not numeric';
  end if;

  if exists (select 1 from logic_game_questions_public where difficulty is null) then
    raise exception 'some questions have no starting difficulty';
  end if;
end;
$$;
