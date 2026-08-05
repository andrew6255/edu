-- Privileged account lifecycle operations used only by the authenticated API.
-- Apply before deploying the API routes that create or delete managed users.

begin;

create table if not exists admin_action_audit(
  id bigint generated always as identity primary key,
  actor_user_id text not null,
  target_user_id text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table admin_action_audit enable row level security;
drop policy if exists admin_action_audit_superadmin_select on admin_action_audit;
create policy admin_action_audit_superadmin_select on admin_action_audit for select to authenticated
using(exists(select 1 from profiles where id=auth.uid()::text and role='superadmin'));

create or replace function server_admin_record_action(p_actor_user_id text,p_target_user_id text,p_action text,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if p_action is null or length(trim(p_action))<3 then raise exception 'Invalid admin audit action'; end if;
  insert into admin_action_audit(actor_user_id,target_user_id,action,metadata)
  values(p_actor_user_id,p_target_user_id,p_action,coalesce(p_metadata,'{}'::jsonb));
end;
$$;
revoke all on function server_admin_record_action(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function server_admin_record_action(text,text,text,jsonb) to service_role;

create or replace function server_admin_delete_user(p_target_uid text, p_delete_linked boolean default true)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_role text;
  v_primary_uid text:=p_target_uid;
  v_linked_uid text;
  v_ids text[];
  v_class_ids text[];
begin
  if p_target_uid is null or length(trim(p_target_uid))<3 then raise exception 'Invalid target user'; end if;
  select role into v_role from profiles where id=p_target_uid;
  if not found then raise exception 'User not found'; end if;

  if p_delete_linked and v_role='student' then
    select parent_id into v_linked_uid from parent_student_links where student_id=p_target_uid limit 1;
  elsif p_delete_linked and v_role='parent' then
    select student_id into v_primary_uid from parent_student_links where parent_id=p_target_uid limit 1;
    if v_primary_uid is not null then v_linked_uid:=p_target_uid; else v_primary_uid:=p_target_uid; end if;
  end if;
  v_ids:=case when v_linked_uid is null then array[v_primary_uid] else array[v_primary_uid,v_linked_uid] end;

  select coalesce(array_agg(doc_id),array[]::text[]) into v_class_ids
  from global_docs
  where collection='teacher_classes' and data->>'teacherId'=any(v_ids);

  -- Remove assets owned by deleted teachers' classrooms or deleted students'
  -- homework submissions before the metadata rows disappear.
  delete from storage.objects
  where bucket_id='classroom-homework'
    and (
      exists(select 1 from unnest(v_class_ids) cid where name like 'classrooms/'||cid||'/%')
      or exists(select 1 from unnest(v_ids) uid where name like '%/submissions/'||uid||'/%')
    );

  delete from global_docs
  where
    (collection='teacher_classes' and doc_id=any(v_class_ids))
    or (data->>'classId'=any(v_class_ids))
    or (data->>'teacherId'=any(v_ids))
    or (data->>'studentId'=any(v_ids))
    or (data->>'userId'=any(v_ids))
    or (data->>'ownerId'=any(v_ids))
    or (collection='userPresence' and doc_id=any(v_ids))
    or exists(select 1 from unnest(v_ids) uid where collection='notifications:'||uid);

  delete from chat_messages where sender_id=any(v_ids);
  delete from chat_rooms where student_id=any(v_ids);
  delete from quiz_attempts where student_id=any(v_ids);
  delete from class_question_progress where user_id=any(v_ids) or graded_by=any(v_ids);
  delete from class_members where user_id=any(v_ids);
  delete from admin_teacher_assignments where admin_id=any(v_ids) or teacher_id=any(v_ids);
  delete from parent_student_links where parent_id=any(v_ids) or student_id=any(v_ids);
  delete from user_docs where user_id=any(v_ids);
  delete from economy_ledger where user_id=any(v_ids);
  delete from user_economy where user_id=any(v_ids);
  delete from logic_game_progress where user_id=any(v_ids);
  delete from question_progress where user_id=any(v_ids);
  delete from profiles where id=any(v_ids);

  return jsonb_build_object('deletedUserIds',to_jsonb(v_ids));
end;
$$;

revoke all on function server_admin_delete_user(text,boolean) from public,anon,authenticated;
grant execute on function server_admin_delete_user(text,boolean) to service_role;

insert into app_schema_migrations(migration_key,details)
values(
  'admin_server_authority_v1',
  jsonb_build_object('description','Service-role-only managed account deletion and audited privileged admin actions')
)
on conflict(migration_key) do update set applied_at=now(),details=excluded.details;

commit;
