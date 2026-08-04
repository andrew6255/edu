-- Classroom homework metadata and student submissions stored in global_docs.
-- Self-contained security helpers make this safe to apply even when the main
-- classroom RLS script has not yet been installed.

create or replace function rls_user_role(uid text)
returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = uid; $$;

create or replace function rls_classroom_teacher_id(p_class_id text)
returns text language sql stable security definer set search_path = public
as $$
  select data->>'teacherId' from global_docs
  where collection = 'teacher_classes' and doc_id = p_class_id;
$$;

create or replace function rls_is_classroom_teacher(p_uid text, p_class_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select rls_classroom_teacher_id(p_class_id) = p_uid; $$;

create or replace function rls_is_classroom_member(p_uid text, p_class_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from global_docs
    where collection = 'teacher_class_members'
      and data->>'classId' = p_class_id
      and data->>'userId' = p_uid
      and coalesce(data->>'kickedAt', '') = ''
  );
$$;

create or replace function rls_homework_class_id(p_homework_id text)
returns text language sql stable security definer set search_path = public
as $$ select data->>'classId' from global_docs where collection = 'class_homeworks' and doc_id = p_homework_id; $$;

create or replace function rls_homework_open(p_homework_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select (data->>'dueAt')::timestamptz >= now() from global_docs where collection = 'class_homeworks' and doc_id = p_homework_id), false); $$;

drop policy if exists gd_homework_select on global_docs;
create policy gd_homework_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'class_homeworks'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_is_classroom_member(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);
drop policy if exists gd_homework_insert on global_docs;
create policy gd_homework_insert on global_docs as restrictive for insert to authenticated
with check (collection <> 'class_homeworks' or rls_is_classroom_teacher(auth.uid()::text, data->>'classId'));
drop policy if exists gd_homework_update on global_docs;
create policy gd_homework_update on global_docs as restrictive for update to authenticated
using (collection <> 'class_homeworks' or rls_is_classroom_teacher(auth.uid()::text, data->>'classId'))
with check (collection <> 'class_homeworks' or rls_is_classroom_teacher(auth.uid()::text, data->>'classId'));
drop policy if exists gd_homework_delete on global_docs;
create policy gd_homework_delete on global_docs as restrictive for delete to authenticated
using (collection <> 'class_homeworks' or rls_is_classroom_teacher(auth.uid()::text, data->>'classId'));

drop policy if exists gd_homework_submission_select on global_docs;
create policy gd_homework_submission_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'homework_submissions'
  or data->>'studentId' = auth.uid()::text
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) = 'superadmin'
);
drop policy if exists gd_homework_submission_insert on global_docs;
create policy gd_homework_submission_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'homework_submissions'
  or (data->>'studentId' = auth.uid()::text and rls_is_classroom_member(auth.uid()::text, data->>'classId') and rls_homework_open(data->>'homeworkId'))
);
drop policy if exists gd_homework_submission_update on global_docs;
create policy gd_homework_submission_update on global_docs as restrictive for update to authenticated
using (collection <> 'homework_submissions' or (data->>'studentId' = auth.uid()::text and rls_homework_open(data->>'homeworkId')))
with check (collection <> 'homework_submissions' or (data->>'studentId' = auth.uid()::text and rls_homework_open(data->>'homeworkId')));
drop policy if exists gd_homework_submission_delete on global_docs;
create policy gd_homework_submission_delete on global_docs as restrictive for delete to authenticated
using (collection <> 'homework_submissions' or (data->>'studentId' = auth.uid()::text and rls_homework_open(data->>'homeworkId')));

-- Storage uploads. Paths are:
-- classrooms/{classId}/homeworks/{homeworkId}/{teacher PDF}
-- classrooms/{classId}/homeworks/{homeworkId}/submissions/{studentId}/{attachment}
drop policy if exists classroom_homework_asset_insert on storage.objects;
create policy classroom_homework_asset_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'program-assets'
  and (storage.foldername(name))[1] = 'classrooms'
  and (storage.foldername(name))[3] = 'homeworks'
  and (
    rls_is_classroom_teacher(auth.uid()::text, (storage.foldername(name))[2])
    or (
      (storage.foldername(name))[5] = 'submissions'
      and (storage.foldername(name))[6] = auth.uid()::text
      and rls_is_classroom_member(auth.uid()::text, (storage.foldername(name))[2])
      and rls_homework_open((storage.foldername(name))[4])
    )
  )
);

-- Students may remove only files inside their own submission folder while the
-- homework is still open. Teacher-owned assignment documents are unaffected.
drop policy if exists classroom_homework_asset_delete on storage.objects;
create policy classroom_homework_asset_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'program-assets'
  and (storage.foldername(name))[1] = 'classrooms'
  and (storage.foldername(name))[3] = 'homeworks'
  and (storage.foldername(name))[5] = 'submissions'
  and (storage.foldername(name))[6] = auth.uid()::text
  and rls_is_classroom_member(auth.uid()::text, (storage.foldername(name))[2])
  and rls_homework_open((storage.foldername(name))[4])
);
