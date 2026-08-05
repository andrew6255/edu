-- Install before deploying the web app that reads public_programs_sanitized.
-- This step is non-breaking: the existing public_programs read policy remains
-- in place until program_answer_confidentiality_lock_migration.sql is applied.

create or replace function sanitize_program_interaction(p_interaction jsonb)
returns jsonb language plpgsql immutable set search_path=public
as $$
declare v_type text; v_result jsonb; v_steps jsonb;
begin
  if jsonb_typeof(p_interaction)<>'object' then return p_interaction; end if;
  v_type:=p_interaction->>'type';
  v_result:=p_interaction-'solution'-'explanation'-'correctAnswer'-'modelAnswer'-'rawAnswerText';
  if v_type='mcq' then
    return jsonb_set(v_result,'{correctChoiceIndex}','-1'::jsonb,true);
  elsif v_type='numeric' then
    return jsonb_set(v_result,'{correct}','null'::jsonb,true);
  elsif v_type='text' then
    return jsonb_set(v_result,'{accepted}','[]'::jsonb,true);
  elsif v_type='line_equation' then
    return jsonb_set(v_result,'{forms}','[]'::jsonb,true);
  elsif v_type='point_list' then
    if not (v_result ? 'minPoints') then
      v_result:=jsonb_set(v_result,'{minPoints}',to_jsonb(jsonb_array_length(coalesce(v_result->'points','[]'::jsonb))),true);
    end if;
    if not (v_result ? 'maxPoints') then v_result:=jsonb_set(v_result,'{maxPoints}',v_result->'minPoints',true); end if;
    return jsonb_set(v_result,'{points}','[]'::jsonb,true);
  elsif v_type='points_on_line' then
    v_result:=jsonb_set(v_result,'{lineForms}','[]'::jsonb,true);
    return jsonb_set(v_result,'{disallowGivenPoints}','[]'::jsonb,true);
  elsif v_type='composite' then
    if jsonb_typeof(v_result->'final')='object' then
      v_result:=jsonb_set(v_result,'{final}',sanitize_program_interaction(v_result->'final'),true);
    end if;
    if jsonb_typeof(v_result->'steps')='array' then
      select coalesce(jsonb_agg(
        case when jsonb_typeof(step.value->'interaction')='object'
          then jsonb_set(step.value-'explanation','{interaction}',sanitize_program_interaction(step.value->'interaction'),true)
          else step.value-'explanation' end order by step.ordinality
      ),'[]'::jsonb) into v_steps
      from jsonb_array_elements(v_result->'steps') with ordinality step(value,ordinality);
      v_result:=jsonb_set(v_result,'{steps}',v_steps,true);
    end if;
  end if;
  return v_result;
end;
$$;

-- Older import pipelines sometimes embedded enrichment and answer fields in
-- question_banks_by_chapter instead of annotations. Recursively remove those
-- legacy fields while preserving prompts, choices, source references and map
-- structure required by the student UI.
create or replace function sanitize_program_question_banks(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=public
as $$
declare v_result jsonb; v_pair record; v_normalized_key text;
begin
  if p_value is null then
    return null;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(sanitize_program_question_banks(item.value) order by item.ordinality),'[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) with ordinality item(value,ordinality);
    return v_result;
  elsif jsonb_typeof(p_value)<>'object' then
    return p_value;
  end if;

  v_result:='{}'::jsonb;
  for v_pair in select key,value from jsonb_each(p_value) loop
    v_normalized_key:=lower(regexp_replace(v_pair.key,'[_-]','','g'));
    if v_normalized_key=any(array[
      'modelanswer','rawanswertext','answerfrompdf','answerkey','correctanswer',
      'correctoptionindex','correctchoiceindex','correct','accepted','forms','lineforms',
      'disallowgivenpoints','solution','solutions','solutionplan','explanation',
      'gradingschema','answerprovenance','answerreviewstatus','explanationscenes'
    ]) then
      continue;
    elsif v_normalized_key='interaction' and jsonb_typeof(v_pair.value)='object' then
      v_result:=v_result||jsonb_build_object(v_pair.key,sanitize_program_interaction(v_pair.value));
    else
      v_result:=v_result||jsonb_build_object(v_pair.key,sanitize_program_question_banks(v_pair.value));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function sanitize_program_annotations(p_annotations jsonb)
returns jsonb language plpgsql immutable set search_path=public
as $$
declare
  v_result jsonb:=coalesce(p_annotations,'{}'::jsonb);
  v_chapter record;
  v_annotation record;
  v_item jsonb;
  v_steps jsonb;
begin
  if jsonb_typeof(v_result->'chapters')<>'object' then return v_result; end if;
  for v_chapter in select key,value from jsonb_each(v_result->'chapters') loop
    if jsonb_typeof(v_chapter.value->'annotations')<>'object' then continue; end if;
    for v_annotation in select key,value from jsonb_each(v_chapter.value->'annotations') loop
      v_item:=v_annotation.value;
      if jsonb_typeof(v_item->'interaction')='object' then
        v_item:=jsonb_set(v_item,'{interaction}',sanitize_program_interaction(v_item->'interaction'),true);
      end if;
      if jsonb_typeof(v_item->'mcq')='object' then
        v_item:=jsonb_set(v_item,'{mcq,correctChoiceIndex}','-1'::jsonb,true);
      end if;
      -- Worked answers are returned by the authenticated grading API only
      -- after an attempt. They must never be present in the public payload.
      v_item:=v_item-'solution'-'explanationScenes';
      if jsonb_typeof(v_item->'stepSolutions')='array' then
        select coalesce(jsonb_agg(
          case when jsonb_typeof(step.value->'interaction')='object'
            then jsonb_set(step.value-'explanation','{interaction}',sanitize_program_interaction(step.value->'interaction'),true)
            else step.value-'explanation' end order by step.ordinality
        ),'[]'::jsonb) into v_steps
        from jsonb_array_elements(v_item->'stepSolutions') with ordinality step(value,ordinality);
        v_item:=jsonb_set(v_item,'{stepSolutions}',v_steps,true);
      end if;
      v_result:=jsonb_set(v_result,array['chapters',v_chapter.key,'annotations',v_annotation.key],v_item,true);
    end loop;
  end loop;
  return v_result;
end;
$$;

drop view if exists public_programs_sanitized;
create view public_programs_sanitized with (security_barrier=true) as
select
  id,title,subject,grade_band,cover_emoji,
  null::jsonb as builder_spec,
  toc,
  sanitize_program_annotations(annotations) as annotations,
  program_meta,sanitize_program_question_banks(question_banks_by_chapter) as question_banks_by_chapter,ranked_total_question_count,
  deleted_at,created_at,updated_at
from public_programs
where deleted_at is null;

revoke all on public_programs_sanitized from public;
grant select on public_programs_sanitized to anon,authenticated;

-- Fail the migration instead of publishing a view if a future edit breaks the
-- expected confidentiality behavior.
do $$
declare v_annotations jsonb; v_banks jsonb;
begin
  v_annotations:=sanitize_program_annotations(
    '{"chapters":{"c1":{"annotations":{"q1":{"interaction":{"type":"mcq","choices":["A","B"],"correctChoiceIndex":1},"solution":{"raw_text":"B"},"explanationScenes":[{"afterText":"B"}],"stepSolutions":[{"id":"s1","explanation":{"raw_text":"B"}}]}}}}}'::jsonb
  );
  if (v_annotations#>>'{chapters,c1,annotations,q1,interaction,correctChoiceIndex}') is distinct from '-1'
     or (v_annotations#>'{chapters,c1,annotations,q1}') ? 'solution'
     or (v_annotations#>'{chapters,c1,annotations,q1}') ? 'explanationScenes'
     or (v_annotations#>'{chapters,c1,annotations,q1,stepSolutions,0}') ? 'explanation' then
    raise exception 'Program annotation sanitizer confidentiality self-check failed';
  end if;

  v_banks:=sanitize_program_question_banks(
    '{"questions":[{"rawText":"Question","modelAnswer":"B","solution":"Because B","mcq":{"choices":["A","B"],"correctChoiceIndex":1},"interaction":{"type":"numeric","correct":42}}]}'::jsonb
  );
  if (v_banks#>'{questions,0}') ? 'modelAnswer'
     or (v_banks#>'{questions,0}') ? 'solution'
     or (v_banks#>'{questions,0,mcq}') ? 'correctChoiceIndex'
     or (v_banks#>'{questions,0,interaction,correct}') is distinct from 'null'::jsonb then
    raise exception 'Program question-bank sanitizer confidentiality self-check failed';
  end if;
end;
$$;

insert into app_schema_migrations(migration_key,details)
values(
  'program_answer_sanitized_view_v1',
  jsonb_build_object('description','Student-safe active-program view without answer keys, worked solutions, or legacy embedded answers')
)
on conflict(migration_key) do update set applied_at=now(),details=excluded.details;
