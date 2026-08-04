-- Enforce session status at the database layer: only active sessions are writable.
-- Apply after classroom_rls.sql.

create or replace function rls_classroom_session_is_active(p_session_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select data->>'status' = 'active' from global_docs
     where collection = 'class_sessions' and doc_id = p_session_id),
    false
  );
$$;

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

  v_session_id := rls_classroom_sheet_session_id(p_sheet_id);
  if v_session_id is null or not rls_classroom_session_is_active(v_session_id) then
    return false;
  end if;

  v_type := rls_classroom_sheet_type(p_sheet_id);

  if rls_is_classroom_teacher(p_uid, v_class_id) then
    if v_type = 'personal' then
      return rls_classroom_sheet_owner_id(p_sheet_id) = p_uid;
    end if;
    return p_layer_id = 'teacher' or p_layer_id like 'annot_%';
  end if;

  if p_layer_id <> p_uid then return false; end if;

  if v_type = 'personal' then
    v_owner_id := rls_classroom_sheet_owner_id(p_sheet_id);
    return v_owner_id = p_uid;
  end if;

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
