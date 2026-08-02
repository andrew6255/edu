-- Shared, canonical AI-generated answer packages.
-- The API server reads/writes with SUPABASE_SERVICE_ROLE_KEY. Students receive
-- scoped tutoring responses from the API instead of direct answer-table access.

create table if not exists question_ai_answers (
  program_id text not null references public_programs(id) on delete cascade,
  question_id text not null,
  question_hash text not null,
  answer_package jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (program_id, question_id)
);

create index if not exists idx_question_ai_answers_question on question_ai_answers(question_id);

alter table question_ai_answers enable row level security;

drop policy if exists question_ai_answers_read_all on question_ai_answers;

drop policy if exists question_ai_answers_superadmin_update on question_ai_answers;
create policy question_ai_answers_superadmin_update on question_ai_answers
for all to authenticated
using (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'))
with check (exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin'));
