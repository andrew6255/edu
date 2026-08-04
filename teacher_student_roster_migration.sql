-- Teacher student roster, private classroom notes, and one-minute roster invites.
-- Apply after classroom_rls.sql.

-- Classroom membership is teacher/admin managed only. Students may no longer
-- add or reactivate themselves through the former classroom join-code flow.
drop policy if exists gd_classroom_tcm_insert on global_docs;
create policy gd_classroom_tcm_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'teacher_class_members'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_classroom_tcm_update on global_docs;
create policy gd_classroom_tcm_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'teacher_class_members'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
)
with check (
  collection <> 'teacher_class_members'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

revoke execute on function join_class_by_code_rpc(text, text, text) from authenticated;

drop policy if exists gd_teacher_notes_select on global_docs;
create policy gd_teacher_notes_select on global_docs as restrictive for select to authenticated
using (collection <> 'teacher_class_notes' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists gd_teacher_notes_insert on global_docs;
create policy gd_teacher_notes_insert on global_docs as restrictive for insert to authenticated
with check (collection <> 'teacher_class_notes' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists gd_teacher_notes_update on global_docs;
create policy gd_teacher_notes_update on global_docs as restrictive for update to authenticated
using (collection <> 'teacher_class_notes' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin')
with check (collection <> 'teacher_class_notes' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists gd_teacher_notes_delete on global_docs;
create policy gd_teacher_notes_delete on global_docs as restrictive for delete to authenticated
using (collection <> 'teacher_class_notes' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists gd_teacher_students_select on global_docs;
create policy gd_teacher_students_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'teacher_students'
  or data->>'teacherId' = auth.uid()::text
  or data->>'studentId' = auth.uid()::text
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_teacher_students_write on global_docs;
drop policy if exists gd_teacher_students_insert on global_docs;
create policy gd_teacher_students_insert on global_docs as restrictive for insert to authenticated
with check (collection <> 'teacher_students' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) in ('admin', 'superadmin'));
drop policy if exists gd_teacher_students_update on global_docs;
create policy gd_teacher_students_update on global_docs as restrictive for update to authenticated
using (collection <> 'teacher_students' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) in ('admin', 'superadmin'))
with check (collection <> 'teacher_students' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) in ('admin', 'superadmin'));
drop policy if exists gd_teacher_students_delete on global_docs;
create policy gd_teacher_students_delete on global_docs as restrictive for delete to authenticated
using (collection <> 'teacher_students' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) in ('admin', 'superadmin'));

drop policy if exists gd_teacher_student_codes_select on global_docs;
create policy gd_teacher_student_codes_select on global_docs as restrictive for select to authenticated
using (collection <> 'teacher_student_codes' or data->>'teacherId' = auth.uid()::text);

drop policy if exists gd_teacher_student_codes_write on global_docs;
create policy gd_teacher_student_codes_write on global_docs as restrictive for all to authenticated
using (collection <> 'teacher_student_codes' or data->>'teacherId' = auth.uid()::text)
with check (collection <> 'teacher_student_codes' or data->>'teacherId' = auth.uid()::text);

drop policy if exists gd_teacher_removed_students_access on global_docs;
create policy gd_teacher_removed_students_access on global_docs as restrictive for all to authenticated
using (collection <> 'teacher_removed_students' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) in ('admin', 'superadmin'))
with check (collection <> 'teacher_removed_students' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) in ('admin', 'superadmin'));

drop policy if exists gd_teacher_student_reports_access on global_docs;
create policy gd_teacher_student_reports_access on global_docs as restrictive for all to authenticated
using (collection <> 'teacher_student_reports' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin')
with check (collection <> 'teacher_student_reports' or data->>'teacherId' = auth.uid()::text or rls_user_role(auth.uid()::text) = 'superadmin');

create or replace function join_teacher_by_student_code_rpc(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text;
  code_data jsonb;
  profile_data record;
  roster_id text;
  now_iso text;
begin
  caller_id := auth.uid()::text;
  if caller_id is null then raise exception 'Not authenticated'; end if;
  if rls_user_role(caller_id) <> 'student' then raise exception 'Only students may redeem this code'; end if;

  now_iso := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select data into code_data
  from global_docs
  where collection = 'teacher_student_codes'
    and data->>'code' = trim(p_code)
    and data->>'expiresAt' > now_iso
  order by data->>'createdAt' desc
  limit 1;

  if code_data is null then return null; end if;

  select username, first_name, last_name, email into profile_data from profiles where id = caller_id;
  roster_id := 'ts_' || (code_data->>'teacherId') || '_' || caller_id;

  delete from global_docs
  where collection = 'teacher_removed_students'
    and doc_id = ('trs_' || (code_data->>'teacherId') || '_' || caller_id);

  insert into global_docs (collection, doc_id, data, updated_at)
  values (
    'teacher_students', roster_id,
    jsonb_build_object(
      'id', roster_id,
      'teacherId', code_data->>'teacherId',
      'studentId', caller_id,
      'username', coalesce(profile_data.username, ''),
      'fullName', trim(coalesce(profile_data.first_name, '') || ' ' || coalesce(profile_data.last_name, '')),
      'email', coalesce(profile_data.email, ''),
      'createdAt', now_iso
    ),
    now()
  )
  on conflict (collection, doc_id) do update
    set data = excluded.data, updated_at = now();

  return jsonb_build_object('teacherId', code_data->>'teacherId', 'teacherName', code_data->>'teacherName');
end;
$$;

revoke all on function join_teacher_by_student_code_rpc(text) from public;
grant execute on function join_teacher_by_student_code_rpc(text) to authenticated;
