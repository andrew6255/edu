-- Classroom feature RLS hardening
-- Run this in the Supabase SQL Editor (or via your migration tool) against a
-- staging project first — this has NOT been executed or tested against a live
-- database as part of this change; review it before applying to production.
--
-- Context: the Classes/Live-Classrooms feature (teacher_classes, teacher_class_members,
-- teacher_class_codes, class_sessions, session_sheets, sheet_strokes, sheet_access)
-- is stored in the generic `global_docs` table, which currently has fully open
-- policies (`using (true)` for any authenticated user — see supabase_schema.sql).
-- Those open policies must stay, since unrelated features also read/write
-- global_docs collections. This file adds RESTRICTIVE policies scoped to just
-- the classroom collections by name. A restrictive policy ANDs against the
-- existing permissive ones rather than replacing them, so every row whose
-- `collection` is NOT one of the classroom collections is left untouched —
-- the restrictive check short-circuits to true for those rows.

-- ─── Security-definer helpers ────────────────────────────────────────────────
-- Read global_docs classroom rows without re-triggering RLS (avoids recursion),
-- following the same pattern as rls_is_class_member / rls_class_teacher_id in
-- fix_rls_recursion.sql.

create or replace function rls_classroom_teacher_id(p_class_id text)
returns text language sql stable security definer set search_path = public
as $$
  select data->>'teacherId' from global_docs
  where collection = 'teacher_classes' and doc_id = p_class_id;
$$;

create or replace function rls_is_classroom_teacher(p_uid text, p_class_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select rls_classroom_teacher_id(p_class_id) = p_uid;
$$;

create or replace function rls_is_classroom_member(p_uid text, p_class_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from global_docs
    where collection = 'teacher_class_members'
      and data->>'classId' = p_class_id
      and data->>'userId' = p_uid
  );
$$;

create or replace function rls_is_parent_of(parent text, student text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from parent_student_links
    where parent_id = parent and student_id = student
  );
$$;

create or replace function rls_parent_can_view_classroom(p_parent_uid text, p_class_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from global_docs
    where collection = 'teacher_class_members'
      and data->>'classId' = p_class_id
      and rls_is_parent_of(p_parent_uid, data->>'userId')
  );
$$;

create or replace function rls_is_classroom_session_participant(p_uid text, p_session_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select data->'participantIds' ? p_uid from global_docs
     where collection = 'class_sessions' and doc_id = p_session_id),
    false
  );
$$;

-- sheet metadata, used by both session_sheets and sheet_strokes/sheet_access policies
create or replace function rls_classroom_sheet_session_id(p_sheet_id text)
returns text language sql stable security definer set search_path = public
as $$
  select data->>'sessionId' from global_docs
  where collection = 'session_sheets' and doc_id = p_sheet_id;
$$;

create or replace function rls_classroom_sheet_class_id(p_sheet_id text)
returns text language sql stable security definer set search_path = public
as $$
  select data->>'classId' from global_docs
  where collection = 'session_sheets' and doc_id = p_sheet_id;
$$;

create or replace function rls_classroom_sheet_type(p_sheet_id text)
returns text language sql stable security definer set search_path = public
as $$
  select data->>'type' from global_docs
  where collection = 'session_sheets' and doc_id = p_sheet_id;
$$;

create or replace function rls_classroom_sheet_owner_id(p_sheet_id text)
returns text language sql stable security definer set search_path = public
as $$
  select data->>'ownerId' from global_docs
  where collection = 'session_sheets' and doc_id = p_sheet_id;
$$;

-- Can p_uid see this (sheet_id, layer_id) stroke layer?
create or replace function rls_classroom_stroke_visible(p_uid text, p_sheet_id text, p_layer_id text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare
  v_class_id text;
  v_session_id text;
  v_type text;
  v_owner_id text;
begin
  v_class_id := rls_classroom_sheet_class_id(p_sheet_id);
  if v_class_id is null then return false; end if;

  v_type := rls_classroom_sheet_type(p_sheet_id);

  -- Personal sheets are visible only to their owner, teacher or student —
  -- a teacher's blanket class access must never extend to a student's
  -- personal sheet (matches getSessionSheets' own app-layer filtering).
  if v_type = 'personal' then
    v_owner_id := rls_classroom_sheet_owner_id(p_sheet_id);
    return v_owner_id = p_uid;
  end if;

  if rls_is_classroom_teacher(p_uid, v_class_id) then
    return true; -- teacher sees every layer on group/individual sheets in their own classes
  end if;

  v_session_id := rls_classroom_sheet_session_id(p_sheet_id);
  if not rls_is_classroom_session_participant(p_uid, v_session_id) then
    return false;
  end if;

  if v_type = 'group' then
    return true; -- every participant sees every layer on a group sheet
  end if;

  -- individual: only the teacher broadcast layer, the student's own layer,
  -- and the teacher's private annotation layer for that student
  return p_layer_id = 'teacher' or p_layer_id = p_uid or p_layer_id = ('annot_' || p_uid);
end;
$$;

-- Can p_uid write to this (sheet_id, layer_id) stroke layer right now?
create or replace function rls_classroom_stroke_writable(p_uid text, p_sheet_id text, p_layer_id text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare
  v_class_id text;
  v_session_id text;
  v_type text;
  v_owner_id text;
  v_access jsonb;
begin
  v_class_id := rls_classroom_sheet_class_id(p_sheet_id);
  if v_class_id is null then return false; end if;

  v_type := rls_classroom_sheet_type(p_sheet_id);

  if rls_is_classroom_teacher(p_uid, v_class_id) then
    if v_type = 'personal' then
      return rls_classroom_sheet_owner_id(p_sheet_id) = p_uid;
    end if;
    -- teacher may broadcast on their own layer or annotate any participant's layer
    return p_layer_id = 'teacher' or p_layer_id like 'annot_%';
  end if;

  -- students may only ever write to their own layer id
  if p_layer_id <> p_uid then return false; end if;

  if v_type = 'personal' then
    v_owner_id := rls_classroom_sheet_owner_id(p_sheet_id);
    return v_owner_id = p_uid;
  end if;

  v_session_id := rls_classroom_sheet_session_id(p_sheet_id);
  if not rls_is_classroom_session_participant(p_uid, v_session_id) then
    return false;
  end if;

  select data into v_access from global_docs
  where collection = 'sheet_access' and doc_id = ('sa_' || p_sheet_id);
  if v_access is null then return false; end if;

  return (v_access->>'masterAccess')::boolean is true
    and (v_access->'studentAccess'->>p_uid)::boolean is true;
end;
$$;

-- ─── Restrictive policies ────────────────────────────────────────────────────
-- One SELECT policy plus separate INSERT/UPDATE/DELETE policies per collection
-- (never a single "for all" alongside a dedicated SELECT policy) — restrictive
-- policies for overlapping commands are ANDed together, and Postgres treats
-- "all" as applying to select too, so pairing a "for all" write policy with a
-- narrower dedicated select policy would silently over-restrict reads with the
-- write policy's (usually tighter) condition. Splitting into insert/update/
-- delete keeps each command's policy set independent and reviewable.
-- Each condition is scoped with "collection <> 'x' or <check>" so it never
-- affects any other collection sharing this table.

-- teacher_classes: teacher, any class member (incl. kicked, so they keep
-- read access to their history), or admin/superadmin can read; only the
-- teacher (or superadmin) may create/rename/end/delete a class.
drop policy if exists gd_classroom_tc_select on global_docs;
create policy gd_classroom_tc_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'teacher_classes'
  or data->>'teacherId' = auth.uid()::text
  or rls_is_classroom_member(auth.uid()::text, doc_id)
  or rls_parent_can_view_classroom(auth.uid()::text, doc_id)
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_classroom_tc_insert on global_docs;
create policy gd_classroom_tc_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'teacher_classes'
  or data->>'teacherId' = auth.uid()::text
  or rls_user_role(auth.uid()::text) = 'superadmin'
);

drop policy if exists gd_classroom_tc_update on global_docs;
create policy gd_classroom_tc_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'teacher_classes'
  or data->>'teacherId' = auth.uid()::text
  or rls_user_role(auth.uid()::text) = 'superadmin'
)
with check (
  collection <> 'teacher_classes'
  or data->>'teacherId' = auth.uid()::text
  or rls_user_role(auth.uid()::text) = 'superadmin'
);

drop policy if exists gd_classroom_tc_delete on global_docs;
create policy gd_classroom_tc_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'teacher_classes'
  or data->>'teacherId' = auth.uid()::text
  or rls_user_role(auth.uid()::text) = 'superadmin'
);

-- teacher_class_members: teacher, the member themself, or admin/superadmin can
-- read. Insert is allowed for the teacher/admin/superadmin (manual add), or
-- the student adding their own row (self-service join normally goes through
-- join_class_by_code_rpc, but this keeps direct inserts consistent). Update
-- (kick/reactivate) and delete (self-delete of an archived membership) follow
-- the same owner-or-teacher-or-admin shape.
drop policy if exists gd_classroom_tcm_select on global_docs;
create policy gd_classroom_tcm_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'teacher_class_members'
  or data->>'userId' = auth.uid()::text
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_is_parent_of(auth.uid()::text, data->>'userId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_classroom_tcm_insert on global_docs;
create policy gd_classroom_tcm_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'teacher_class_members'
  or data->>'userId' = auth.uid()::text
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_classroom_tcm_update on global_docs;
create policy gd_classroom_tcm_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'teacher_class_members'
  or data->>'userId' = auth.uid()::text
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
)
with check (
  collection <> 'teacher_class_members'
  or data->>'userId' = auth.uid()::text
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_classroom_tcm_delete on global_docs;
create policy gd_classroom_tcm_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'teacher_class_members'
  or data->>'userId' = auth.uid()::text
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

-- teacher_class_codes: never openly readable — joining goes through
-- join_class_by_code_rpc below (security definer, bypasses RLS). Only the
-- creating teacher can read/write their own generated codes directly.
drop policy if exists gd_classroom_tcc_select on global_docs;
create policy gd_classroom_tcc_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'teacher_class_codes'
  or (data->>'createdBy' = auth.uid()::text and rls_is_classroom_teacher(auth.uid()::text, data->>'classId'))
);

drop policy if exists gd_classroom_tcc_insert on global_docs;
create policy gd_classroom_tcc_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'teacher_class_codes'
  or (data->>'createdBy' = auth.uid()::text and rls_is_classroom_teacher(auth.uid()::text, data->>'classId'))
);

drop policy if exists gd_classroom_tcc_update on global_docs;
create policy gd_classroom_tcc_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'teacher_class_codes'
  or (data->>'createdBy' = auth.uid()::text and rls_is_classroom_teacher(auth.uid()::text, data->>'classId'))
)
with check (
  collection <> 'teacher_class_codes'
  or (data->>'createdBy' = auth.uid()::text and rls_is_classroom_teacher(auth.uid()::text, data->>'classId'))
);

drop policy if exists gd_classroom_tcc_delete on global_docs;
create policy gd_classroom_tcc_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'teacher_class_codes'
  or (data->>'createdBy' = auth.uid()::text and rls_is_classroom_teacher(auth.uid()::text, data->>'classId'))
);

-- class_sessions: teacher or a session participant can read; only the teacher writes.
drop policy if exists gd_classroom_cs_select on global_docs;
create policy gd_classroom_cs_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'class_sessions'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
  or data->'participantIds' ? auth.uid()::text
  or rls_parent_can_view_classroom(auth.uid()::text, data->>'classId')
  or rls_user_role(auth.uid()::text) in ('admin', 'superadmin')
);

drop policy if exists gd_classroom_cs_insert on global_docs;
create policy gd_classroom_cs_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'class_sessions'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
);

drop policy if exists gd_classroom_cs_update on global_docs;
create policy gd_classroom_cs_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'class_sessions'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
)
with check (
  collection <> 'class_sessions'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
);

drop policy if exists gd_classroom_cs_delete on global_docs;
create policy gd_classroom_cs_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'class_sessions'
  or rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
);

-- session_sheets: teacher sees all sheets in their classes; a participant sees
-- group/individual sheets in sessions they're part of, plus their own personal
-- sheets. Teacher writes any sheet type; a student may only create/rename/
-- delete their own personal sheets.
-- Note: "teacher of the class AND NOT a student's own personal sheet" is
-- repeated deliberately rather than factored into a helper — a teacher's
-- blanket class access must never extend to a student's personal sheet,
-- matching getSessionSheets' own app-layer filtering ("teacher sees all
-- sheets except student personal sheets").
drop policy if exists gd_classroom_ss_select on global_docs;
create policy gd_classroom_ss_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'session_sheets'
  or (
    rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
    and not (data->>'type' = 'personal' and data->>'ownerType' = 'student')
  )
  or (data->>'type' = 'personal' and data->>'ownerId' = auth.uid()::text)
  or (data->>'type' in ('group', 'individual') and rls_is_classroom_session_participant(auth.uid()::text, data->>'sessionId'))
);

drop policy if exists gd_classroom_ss_insert on global_docs;
create policy gd_classroom_ss_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'session_sheets'
  or (
    rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
    and not (data->>'type' = 'personal' and data->>'ownerType' = 'student')
  )
  or (data->>'type' = 'personal' and data->>'ownerId' = auth.uid()::text and data->>'ownerType' = 'student')
);

drop policy if exists gd_classroom_ss_update on global_docs;
create policy gd_classroom_ss_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'session_sheets'
  or (
    rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
    and not (data->>'type' = 'personal' and data->>'ownerType' = 'student')
  )
  or (data->>'type' = 'personal' and data->>'ownerId' = auth.uid()::text)
)
with check (
  collection <> 'session_sheets'
  or (
    rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
    and not (data->>'type' = 'personal' and data->>'ownerType' = 'student')
  )
  or (data->>'type' = 'personal' and data->>'ownerId' = auth.uid()::text and data->>'ownerType' = 'student')
);

drop policy if exists gd_classroom_ss_delete on global_docs;
create policy gd_classroom_ss_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'session_sheets'
  or (
    rls_is_classroom_teacher(auth.uid()::text, data->>'classId')
    and not (data->>'type' = 'personal' and data->>'ownerType' = 'student')
  )
  or (data->>'type' = 'personal' and data->>'ownerId' = auth.uid()::text)
);

-- sheet_strokes: visibility/write rules delegate to the helper functions above,
-- which already implement the personal / group / individual composed-layer model.
drop policy if exists gd_classroom_sst_select on global_docs;
create policy gd_classroom_sst_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'sheet_strokes'
  or rls_classroom_stroke_visible(auth.uid()::text, data->>'sheetId', data->>'layerId')
);

drop policy if exists gd_classroom_sst_insert on global_docs;
create policy gd_classroom_sst_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'sheet_strokes'
  or rls_classroom_stroke_writable(auth.uid()::text, data->>'sheetId', data->>'layerId')
);

drop policy if exists gd_classroom_sst_update on global_docs;
create policy gd_classroom_sst_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'sheet_strokes'
  or rls_classroom_stroke_writable(auth.uid()::text, data->>'sheetId', data->>'layerId')
)
with check (
  collection <> 'sheet_strokes'
  or rls_classroom_stroke_writable(auth.uid()::text, data->>'sheetId', data->>'layerId')
);

-- Delete additionally allows the teacher to remove ANY layer (including a
-- student's own) on a sheet in their own class, since deleteSheet() cascades
-- to every stroke doc when a teacher deletes a group/individual sheet — but
-- never on a student's personal sheet, matching the same exclusion as above.
drop policy if exists gd_classroom_sst_delete on global_docs;
create policy gd_classroom_sst_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'sheet_strokes'
  or rls_classroom_stroke_writable(auth.uid()::text, data->>'sheetId', data->>'layerId')
  or (
    rls_is_classroom_teacher(auth.uid()::text, rls_classroom_sheet_class_id(data->>'sheetId'))
    and not (
      rls_classroom_sheet_type(data->>'sheetId') = 'personal'
      and rls_classroom_sheet_owner_id(data->>'sheetId') <> auth.uid()::text
    )
  )
);

-- sheet_access: teacher and session participants can read (students need to
-- see their own toggle state); only the teacher may change access.
-- (SheetAccess docs store their own `sheetId` field, so no doc_id parsing needed.)
drop policy if exists gd_classroom_sa_select on global_docs;
create policy gd_classroom_sa_select on global_docs as restrictive for select to authenticated
using (
  collection <> 'sheet_access'
  or rls_is_classroom_teacher(auth.uid()::text, rls_classroom_sheet_class_id(data->>'sheetId'))
  or rls_is_classroom_session_participant(auth.uid()::text, rls_classroom_sheet_session_id(data->>'sheetId'))
);

drop policy if exists gd_classroom_sa_insert on global_docs;
create policy gd_classroom_sa_insert on global_docs as restrictive for insert to authenticated
with check (
  collection <> 'sheet_access'
  or rls_is_classroom_teacher(auth.uid()::text, rls_classroom_sheet_class_id(data->>'sheetId'))
);

drop policy if exists gd_classroom_sa_update on global_docs;
create policy gd_classroom_sa_update on global_docs as restrictive for update to authenticated
using (
  collection <> 'sheet_access'
  or rls_is_classroom_teacher(auth.uid()::text, rls_classroom_sheet_class_id(data->>'sheetId'))
)
with check (
  collection <> 'sheet_access'
  or rls_is_classroom_teacher(auth.uid()::text, rls_classroom_sheet_class_id(data->>'sheetId'))
);

drop policy if exists gd_classroom_sa_delete on global_docs;
create policy gd_classroom_sa_delete on global_docs as restrictive for delete to authenticated
using (
  collection <> 'sheet_access'
  or rls_is_classroom_teacher(auth.uid()::text, rls_classroom_sheet_class_id(data->>'sheetId'))
);

-- ─── Join-by-code RPC ────────────────────────────────────────────────────────
-- Runs as the DB owner so it can look up a code the joining student isn't
-- otherwise allowed to SELECT (teacher_class_codes is locked down above), then
-- creates/reactivates their membership row. Mirrors joinClassByCode's existing
-- re-join-after-kick behavior in classroomService.ts.

create or replace function join_class_by_code_rpc(p_code text, p_username text, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text;
  v_code_class_id text;
  v_code_expires text;
  cls_data jsonb;
  member_id text;
  now_iso text;
begin
  caller_id := auth.uid()::text;
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  now_iso := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  select data->>'classId', data->>'expiresAt'
    into v_code_class_id, v_code_expires
  from global_docs
  where collection = 'teacher_class_codes' and data->>'code' = p_code
  order by data->>'createdAt' desc
  limit 1;

  if v_code_class_id is null or v_code_expires <= now_iso then
    raise exception 'Invalid or expired code';
  end if;

  select data into cls_data from global_docs
  where collection = 'teacher_classes' and doc_id = v_code_class_id;

  if cls_data is null then
    raise exception 'Class not found';
  end if;
  if cls_data->>'status' = 'ended' then
    raise exception 'This class has ended';
  end if;

  member_id := 'tcm_' || (cls_data->>'id') || '_' || caller_id;

  insert into global_docs (collection, doc_id, data, updated_at)
  values (
    'teacher_class_members',
    member_id,
    jsonb_build_object(
      'id', member_id,
      'classId', cls_data->>'id',
      'userId', caller_id,
      'username', p_username,
      'fullName', p_full_name,
      'role', 'student',
      'joinedAt', now_iso,
      'kickedAt', null
    ),
    now()
  )
  on conflict (collection, doc_id) do update
    set data = (global_docs.data || jsonb_build_object('kickedAt', null, 'joinedAt', now_iso)),
        updated_at = now();

  return cls_data;
end;
$$;
