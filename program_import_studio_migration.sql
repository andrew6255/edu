-- Question Import Studio: versioning, organizer audit history, optimistic saves,
-- atomic publish, and rollback-to-draft. Apply after supabase_schema.sql.

alter table draft_programs add column if not exists revision integer not null default 0;
alter table public_programs add column if not exists version_number integer not null default 0;

create table if not exists program_versions (
  id bigint generated always as identity primary key,
  program_id text not null,
  version_number integer not null,
  snapshot jsonb not null,
  published_by text not null references profiles(id),
  published_at timestamptz not null default now(),
  unique(program_id, version_number)
);

create table if not exists program_organizer_decisions (
  id bigint generated always as identity primary key,
  program_id text not null,
  draft_revision integer not null,
  batch_id text,
  provider text,
  proposal jsonb not null,
  approved_tree jsonb not null,
  placements jsonb not null,
  decided_by text not null references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists program_versions_program_idx on program_versions(program_id, version_number desc);
create index if not exists program_organizer_decisions_program_idx on program_organizer_decisions(program_id, created_at desc);

alter table program_versions enable row level security;
alter table program_organizer_decisions enable row level security;

drop policy if exists program_versions_superadmin_read on program_versions;
create policy program_versions_superadmin_read on program_versions for select to authenticated using (
  exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin')
);
drop policy if exists organizer_decisions_superadmin_read on program_organizer_decisions;
create policy organizer_decisions_superadmin_read on program_organizer_decisions for select to authenticated using (
  exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin')
);

create or replace function save_program_draft_revision(
  p_program_id text,
  p_payload jsonb,
  p_expected_revision integer,
  p_organizer_decision jsonb default null
) returns table(revision integer, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_revision integer;
  next_revision integer;
  saved_at timestamptz := now();
begin
  if not exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin') then
    raise exception 'Superadmin access required';
  end if;

  select d.revision into current_revision from draft_programs d where d.id = p_program_id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'DRAFT_REVISION_CONFLICT expected %, found missing', p_expected_revision using errcode = '40001'; end if;
    next_revision := 1;
    insert into draft_programs(id,title,subject,grade_band,cover_emoji,builder_spec,toc,annotations,program_meta,question_banks_by_chapter,ranked_total_question_count,deleted_at,updated_at,revision)
    values (p_program_id,coalesce(p_payload->>'title',p_program_id),coalesce(p_payload->>'subject','mathematics'),p_payload->>'grade_band',p_payload->>'cover_emoji',p_payload->'builder_spec',p_payload->'toc',p_payload->'annotations',p_payload->'program_meta',p_payload->'question_banks_by_chapter',coalesce((p_payload->>'ranked_total_question_count')::integer,0),null,saved_at,next_revision);
  else
    if current_revision <> p_expected_revision then raise exception 'DRAFT_REVISION_CONFLICT expected %, found %', p_expected_revision, current_revision using errcode = '40001'; end if;
    next_revision := current_revision + 1;
    update draft_programs set
      title=coalesce(p_payload->>'title',title), subject=coalesce(p_payload->>'subject',subject), grade_band=p_payload->>'grade_band', cover_emoji=p_payload->>'cover_emoji',
      builder_spec=p_payload->'builder_spec', toc=p_payload->'toc', annotations=p_payload->'annotations', program_meta=p_payload->'program_meta',
      question_banks_by_chapter=p_payload->'question_banks_by_chapter', ranked_total_question_count=coalesce((p_payload->>'ranked_total_question_count')::integer,0),
      updated_at=saved_at, revision=next_revision where id=p_program_id;
  end if;

  if p_organizer_decision is not null then
    insert into program_organizer_decisions(program_id,draft_revision,batch_id,provider,proposal,approved_tree,placements,decided_by)
    values (p_program_id,next_revision,p_organizer_decision->>'batchId',p_organizer_decision->>'provider',coalesce(p_organizer_decision->'proposal','{}'::jsonb),coalesce(p_organizer_decision->'approvedTree','[]'::jsonb),coalesce(p_organizer_decision->'placements','[]'::jsonb),auth.uid()::text);
  end if;
  return query select next_revision, saved_at;
end $$;

create or replace function publish_program_draft_revision(p_program_id text, p_expected_revision integer)
returns table(version_number integer, published_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  d draft_programs%rowtype;
  next_version integer;
  published_time timestamptz := now();
begin
  if not exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin') then raise exception 'Superadmin access required'; end if;
  select * into d from draft_programs where id=p_program_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if d.revision <> p_expected_revision then raise exception 'DRAFT_REVISION_CONFLICT expected %, found %', p_expected_revision,d.revision using errcode='40001'; end if;
  select coalesce(max(v.version_number),0)+1 into next_version from program_versions v where v.program_id=p_program_id;
  insert into public_programs(id,title,subject,grade_band,cover_emoji,builder_spec,toc,annotations,program_meta,question_banks_by_chapter,ranked_total_question_count,deleted_at,updated_at,version_number)
  values(d.id,d.title,d.subject,d.grade_band,d.cover_emoji,d.builder_spec,d.toc,d.annotations,d.program_meta,d.question_banks_by_chapter,d.ranked_total_question_count,null,published_time,next_version)
  on conflict(id) do update set title=excluded.title,subject=excluded.subject,grade_band=excluded.grade_band,cover_emoji=excluded.cover_emoji,builder_spec=excluded.builder_spec,toc=excluded.toc,annotations=excluded.annotations,program_meta=excluded.program_meta,question_banks_by_chapter=excluded.question_banks_by_chapter,ranked_total_question_count=excluded.ranked_total_question_count,deleted_at=null,updated_at=excluded.updated_at,version_number=excluded.version_number;
  insert into program_versions(program_id,version_number,snapshot,published_by,published_at)
  values(p_program_id,next_version,to_jsonb(d)-'revision' || jsonb_build_object('version_number',next_version),auth.uid()::text,published_time);
  delete from draft_programs where id=p_program_id;
  return query select next_version,published_time;
end $$;

create or replace function rollback_program_version_to_draft(p_program_id text, p_version_number integer)
returns table(revision integer, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare s jsonb; saved_at timestamptz := now();
begin
  if not exists (select 1 from profiles where id = auth.uid()::text and role = 'superadmin') then raise exception 'Superadmin access required'; end if;
  select snapshot into s from program_versions where program_id=p_program_id and version_number=p_version_number;
  if s is null then raise exception 'Program version not found'; end if;
  if exists(select 1 from draft_programs where id=p_program_id) then raise exception 'ACTIVE_DRAFT_EXISTS'; end if;
  insert into draft_programs(id,title,subject,grade_band,cover_emoji,builder_spec,toc,annotations,program_meta,question_banks_by_chapter,ranked_total_question_count,deleted_at,updated_at,revision)
  values(p_program_id,s->>'title',coalesce(s->>'subject','mathematics'),s->>'grade_band',s->>'cover_emoji',s->'builder_spec',s->'toc',s->'annotations',s->'program_meta',s->'question_banks_by_chapter',coalesce((s->>'ranked_total_question_count')::integer,0),null,saved_at,1);
  return query select 1,saved_at;
end $$;

revoke all on function save_program_draft_revision(text,jsonb,integer,jsonb) from public;
revoke all on function publish_program_draft_revision(text,integer) from public;
revoke all on function rollback_program_version_to_draft(text,integer) from public;
grant execute on function save_program_draft_revision(text,jsonb,integer,jsonb) to authenticated;
grant execute on function publish_program_draft_revision(text,integer) to authenticated;
grant execute on function rollback_program_version_to_draft(text,integer) to authenticated;

