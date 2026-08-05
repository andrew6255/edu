-- Atomic, authenticated friend relationship functions. Safe to rerun.
-- Run after profiles exists.

begin;

drop function if exists send_friend_request_rpc(uuid);
drop function if exists accept_friend_request_rpc(uuid);
drop function if exists decline_friend_request_rpc(uuid);
drop function if exists remove_friend_rpc(uuid);

create or replace function friend_array_without(p_array jsonb, p_value text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_array, '[]'::jsonb)) value
  where value <> to_jsonb(p_value);
$$;

create or replace function send_friend_request_rpc(target_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text := auth.uid()::text;
  v_sender_state jsonb;
  v_target_state jsonb;
begin
  if v_sender is null then raise exception 'Not authenticated'; end if;
  if target_uid is null or target_uid = v_sender then raise exception 'Invalid friend target'; end if;

  perform id from profiles where id in (v_sender, target_uid) order by id for update;
  select coalesce(user_state, '{}'::jsonb) into v_sender_state from profiles where id = v_sender;
  select coalesce(user_state, '{}'::jsonb) into v_target_state from profiles where id = target_uid;
  if v_sender_state is null or v_target_state is null then raise exception 'Profile not found'; end if;
  if coalesce(v_sender_state->'friends', '[]'::jsonb) ? target_uid
     or coalesce(v_target_state->'friends', '[]'::jsonb) ? v_sender then
    raise exception 'You are already friends';
  end if;

  if not coalesce(v_target_state->'incomingRequests', '[]'::jsonb) ? v_sender then
    v_target_state := jsonb_set(
      v_target_state, '{incomingRequests}',
      coalesce(v_target_state->'incomingRequests', '[]'::jsonb) || jsonb_build_array(v_sender), true
    );
  end if;
  if not coalesce(v_sender_state->'outgoingRequests', '[]'::jsonb) ? target_uid then
    v_sender_state := jsonb_set(
      v_sender_state, '{outgoingRequests}',
      coalesce(v_sender_state->'outgoingRequests', '[]'::jsonb) || jsonb_build_array(target_uid), true
    );
  end if;

  update profiles set user_state = v_sender_state, updated_at = now() where id = v_sender;
  update profiles set user_state = v_target_state, updated_at = now() where id = target_uid;
end;
$$;

create or replace function accept_friend_request_rpc(target_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_my_state jsonb;
  v_target_state jsonb;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if target_uid is null or target_uid = v_me then raise exception 'Invalid friend target'; end if;

  perform id from profiles where id in (v_me, target_uid) order by id for update;
  select coalesce(user_state, '{}'::jsonb) into v_my_state from profiles where id = v_me;
  select coalesce(user_state, '{}'::jsonb) into v_target_state from profiles where id = target_uid;
  if v_my_state is null or v_target_state is null then raise exception 'Profile not found'; end if;
  if not coalesce(v_my_state->'incomingRequests', '[]'::jsonb) ? target_uid
     or not coalesce(v_target_state->'outgoingRequests', '[]'::jsonb) ? v_me then
    raise exception 'No pending friend request';
  end if;

  v_my_state := jsonb_set(v_my_state, '{incomingRequests}', friend_array_without(v_my_state->'incomingRequests', target_uid), true);
  v_target_state := jsonb_set(v_target_state, '{outgoingRequests}', friend_array_without(v_target_state->'outgoingRequests', v_me), true);
  if not coalesce(v_my_state->'friends', '[]'::jsonb) ? target_uid then
    v_my_state := jsonb_set(v_my_state, '{friends}', coalesce(v_my_state->'friends', '[]'::jsonb) || jsonb_build_array(target_uid), true);
  end if;
  if not coalesce(v_target_state->'friends', '[]'::jsonb) ? v_me then
    v_target_state := jsonb_set(v_target_state, '{friends}', coalesce(v_target_state->'friends', '[]'::jsonb) || jsonb_build_array(v_me), true);
  end if;

  update profiles set user_state = v_my_state, updated_at = now() where id = v_me;
  update profiles set user_state = v_target_state, updated_at = now() where id = target_uid;
end;
$$;

create or replace function decline_friend_request_rpc(target_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if target_uid is null or target_uid = v_me then raise exception 'Invalid friend target'; end if;
  perform id from profiles where id in (v_me, target_uid) order by id for update;
  update profiles set
    user_state = jsonb_set(coalesce(user_state, '{}'::jsonb), '{incomingRequests}', friend_array_without(user_state->'incomingRequests', target_uid), true),
    updated_at = now()
  where id = v_me;
  update profiles set
    user_state = jsonb_set(coalesce(user_state, '{}'::jsonb), '{outgoingRequests}', friend_array_without(user_state->'outgoingRequests', v_me), true),
    updated_at = now()
  where id = target_uid;
end;
$$;

create or replace function remove_friend_rpc(target_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if target_uid is null or target_uid = v_me then raise exception 'Invalid friend target'; end if;
  perform id from profiles where id in (v_me, target_uid) order by id for update;
  update profiles set
    user_state = jsonb_set(coalesce(user_state, '{}'::jsonb), '{friends}', friend_array_without(user_state->'friends', target_uid), true),
    updated_at = now()
  where id = v_me;
  update profiles set
    user_state = jsonb_set(coalesce(user_state, '{}'::jsonb), '{friends}', friend_array_without(user_state->'friends', v_me), true),
    updated_at = now()
  where id = target_uid;
end;
$$;

revoke all on function friend_array_without(jsonb, text) from public;
revoke all on function send_friend_request_rpc(text) from public;
revoke all on function accept_friend_request_rpc(text) from public;
revoke all on function decline_friend_request_rpc(text) from public;
revoke all on function remove_friend_rpc(text) from public;
grant execute on function send_friend_request_rpc(text) to authenticated;
grant execute on function accept_friend_request_rpc(text) to authenticated;
grant execute on function decline_friend_request_rpc(text) to authenticated;
grant execute on function remove_friend_rpc(text) to authenticated;

commit;
