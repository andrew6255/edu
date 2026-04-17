-- ─── Security-definer helpers (break RLS recursion) ─────────────────────────
-- These functions run as the DB owner and skip RLS, so policies that need to
-- peek at a different RLS-protected table can call them without triggering
-- infinite recursion.

create or replace function rls_user_role(uid text)
returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = uid; $$;

create or replace function rls_is_class_member(uid text, cid text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from class_members where user_id = uid and class_id = cid); $$;

create or replace function rls_is_class_member_role(uid text, cid text, r text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from class_members where user_id = uid and class_id = cid and role = r); $$;

create or replace function rls_class_teacher_id(cid text)
returns text language sql stable security definer set search_path = public
as $$ select teacher_id from classes where id = cid; $$;

create or replace function rls_student_class_ids(uid text)
returns setof text language sql stable security definer set search_path = public
as $$ select class_id from class_members where user_id = uid; $$;

create or replace function rls_parent_student_ids(parent text)
returns setof text language sql stable security definer set search_path = public
as $$ select student_id from parent_student_links where parent_id = parent; $$;

create or replace function rls_admin_teacher_ids(admin text)
returns setof text language sql stable security definer set search_path = public
as $$ select teacher_id from admin_teacher_assignments where admin_id = admin; $$;

create or replace function rls_content_class_id(content_id text)
returns text language sql stable security definer set search_path = public
as $$ select class_id from class_content where id = content_id; $$;

create or replace function rls_chat_room_class_student(room_id text)
returns table(class_id text, student_id text) language sql stable security definer set search_path = public
as $$ select class_id, student_id from chat_rooms where id = room_id; $$;

create or replace function rls_is_parent_of(parent text, student text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from parent_student_links where parent_id = parent and student_id = student); $$;

-- ─── Fix classes policies ───────────────────────────────────────────────────

drop policy if exists classes_ta_select on classes;
create policy classes_ta_select on classes for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, classes.id, 'teacher_assistant'));

drop policy if exists classes_student_select on classes;
create policy classes_student_select on classes for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, classes.id, 'student'));

drop policy if exists classes_parent_select on classes;
create policy classes_parent_select on classes for select to authenticated
using (
  classes.id in (
    select cid from rls_parent_student_ids(auth.uid()::text) sid,
    lateral rls_student_class_ids(sid) cid
  )
);

-- ─── Fix class_members policies ─────────────────────────────────────────────

drop policy if exists cm_superadmin_all on class_members;
create policy cm_superadmin_all on class_members for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists cm_admin_select on class_members;
create policy cm_admin_select on class_members for select to authenticated
using (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_admin_insert on class_members;
create policy cm_admin_insert on class_members for insert to authenticated
with check (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_admin_update on class_members;
create policy cm_admin_update on class_members for update to authenticated
using (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)))
with check (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_admin_delete on class_members;
create policy cm_admin_delete on class_members for delete to authenticated
using (rls_class_teacher_id(class_members.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cm_teacher_select on class_members;
create policy cm_teacher_select on class_members for select to authenticated
using (rls_class_teacher_id(class_members.class_id) = auth.uid()::text);

-- ─── Fix parent_student_links policies ──────────────────────────────────────

drop policy if exists psl_superadmin_all on parent_student_links;
create policy psl_superadmin_all on parent_student_links for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists psl_admin_select on parent_student_links;
create policy psl_admin_select on parent_student_links for select to authenticated
using (exists (
  select 1 from rls_student_class_ids(parent_student_links.student_id) cid
  where rls_class_teacher_id(cid) in (select rls_admin_teacher_ids(auth.uid()::text))
));

drop policy if exists psl_teacher_select on parent_student_links;
create policy psl_teacher_select on parent_student_links for select to authenticated
using (exists (
  select 1 from rls_student_class_ids(parent_student_links.student_id) cid
  where rls_class_teacher_id(cid) = auth.uid()::text
));

-- ─── Fix class_content policies ─────────────────────────────────────────────

drop policy if exists cc_superadmin_all on class_content;
create policy cc_superadmin_all on class_content for all to authenticated
using (rls_user_role(auth.uid()::text) = 'superadmin')
with check (rls_user_role(auth.uid()::text) = 'superadmin');

drop policy if exists cc_admin_select on class_content;
create policy cc_admin_select on class_content for select to authenticated
using (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_admin_insert on class_content;
create policy cc_admin_insert on class_content for insert to authenticated
with check (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_admin_update on class_content;
create policy cc_admin_update on class_content for update to authenticated
using (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)))
with check (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_admin_delete on class_content;
create policy cc_admin_delete on class_content for delete to authenticated
using (rls_class_teacher_id(class_content.class_id) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cc_teacher_select on class_content;
create policy cc_teacher_select on class_content for select to authenticated
using (rls_class_teacher_id(class_content.class_id) = auth.uid()::text);

drop policy if exists cc_ta_select on class_content;
create policy cc_ta_select on class_content for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, class_content.class_id, 'teacher_assistant'));

drop policy if exists cc_student_select on class_content;
create policy cc_student_select on class_content for select to authenticated
using (
  status = 'published'
  and rls_is_class_member_role(auth.uid()::text, class_content.class_id, 'student')
);

drop policy if exists cc_parent_select on class_content;
create policy cc_parent_select on class_content for select to authenticated
using (
  status = 'published'
  and class_content.class_id in (
    select cid from rls_parent_student_ids(auth.uid()::text) sid,
    lateral rls_student_class_ids(sid) cid
  )
);

-- ─── Fix quiz_attempts policies ─────────────────────────────────────────────

drop policy if exists qa_admin_select on quiz_attempts;
create policy qa_admin_select on quiz_attempts for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(quiz_attempts.quiz_id)) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists qa_teacher_select on quiz_attempts;
create policy qa_teacher_select on quiz_attempts for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(quiz_attempts.quiz_id)) = auth.uid()::text);

drop policy if exists qa_ta_select on quiz_attempts;
create policy qa_ta_select on quiz_attempts for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(quiz_attempts.quiz_id), 'teacher_assistant'));

drop policy if exists qa_ta_update on quiz_attempts;
create policy qa_ta_update on quiz_attempts for update to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(quiz_attempts.quiz_id), 'teacher_assistant'))
with check (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(quiz_attempts.quiz_id), 'teacher_assistant'));

-- ─── Fix class_question_progress policies ───────────────────────────────────

drop policy if exists cqp_admin_select on class_question_progress;
create policy cqp_admin_select on class_question_progress for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(class_question_progress.content_id)) in (select rls_admin_teacher_ids(auth.uid()::text)));

drop policy if exists cqp_teacher_select on class_question_progress;
create policy cqp_teacher_select on class_question_progress for select to authenticated
using (rls_class_teacher_id(rls_content_class_id(class_question_progress.content_id)) = auth.uid()::text);

drop policy if exists cqp_ta_select on class_question_progress;
create policy cqp_ta_select on class_question_progress for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(class_question_progress.content_id), 'teacher_assistant'));

drop policy if exists cqp_ta_update on class_question_progress;
create policy cqp_ta_update on class_question_progress for update to authenticated
using (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(class_question_progress.content_id), 'teacher_assistant'))
with check (rls_is_class_member_role(auth.uid()::text, rls_content_class_id(class_question_progress.content_id), 'teacher_assistant'));

drop policy if exists cqp_parent_select on class_question_progress;
create policy cqp_parent_select on class_question_progress for select to authenticated
using (rls_is_parent_of(auth.uid()::text, class_question_progress.user_id));

-- ─── Fix chat_rooms policies ────────────────────────────────────────────────

drop policy if exists cr_teacher_select on chat_rooms;
create policy cr_teacher_select on chat_rooms for select to authenticated
using (rls_class_teacher_id(chat_rooms.class_id) = auth.uid()::text);

drop policy if exists cr_teacher_insert on chat_rooms;
create policy cr_teacher_insert on chat_rooms for insert to authenticated
with check (rls_class_teacher_id(chat_rooms.class_id) = auth.uid()::text);

drop policy if exists cr_ta_select on chat_rooms;
create policy cr_ta_select on chat_rooms for select to authenticated
using (rls_is_class_member_role(auth.uid()::text, chat_rooms.class_id, 'teacher_assistant'));

drop policy if exists cr_parent_select on chat_rooms;
create policy cr_parent_select on chat_rooms for select to authenticated
using (rls_is_parent_of(auth.uid()::text, chat_rooms.student_id));

-- ─── Fix chat_messages policies ─────────────────────────────────────────────

drop policy if exists cmsg_room_member_select on chat_messages;
create policy cmsg_room_member_select on chat_messages for select to authenticated
using (exists (
  select 1 from rls_chat_room_class_student(chat_messages.room_id) cr where (
    rls_class_teacher_id(cr.class_id) = auth.uid()::text
    or rls_is_class_member_role(auth.uid()::text, cr.class_id, 'teacher_assistant')
    or rls_is_parent_of(auth.uid()::text, cr.student_id)
  )
));

drop policy if exists cmsg_room_member_insert on chat_messages;
create policy cmsg_room_member_insert on chat_messages for insert to authenticated
with check (
  sender_id = auth.uid()::text
  and exists (
    select 1 from rls_chat_room_class_student(chat_messages.room_id) cr where (
      rls_class_teacher_id(cr.class_id) = auth.uid()::text
      or rls_is_class_member_role(auth.uid()::text, cr.class_id, 'teacher_assistant')
      or rls_is_parent_of(auth.uid()::text, cr.student_id)
    )
  )
);
