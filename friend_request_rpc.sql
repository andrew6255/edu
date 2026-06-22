-- Secure Postgres Functions for Friend Requests (Bypasses RLS Safely)
-- Run this in the Supabase SQL Editor

-- Clean up the old functions that used 'uuid' to avoid overloading conflicts
DROP FUNCTION IF EXISTS send_friend_request_rpc(uuid);
DROP FUNCTION IF EXISTS accept_friend_request_rpc(uuid);
DROP FUNCTION IF EXISTS decline_friend_request_rpc(uuid);
DROP FUNCTION IF EXISTS remove_friend_rpc(uuid);

-- 1. Send Friend Request (Appends sender to target's incomingRequests)
CREATE OR REPLACE FUNCTION send_friend_request_rpc(target_uid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_state jsonb;
  incoming jsonb;
  sender_id text;
BEGIN
  sender_id := auth.uid()::text;
  IF sender_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT user_state INTO current_state FROM profiles WHERE id = target_uid;
  IF current_state IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  incoming := COALESCE(current_state -> 'incomingRequests', '[]'::jsonb);
  
  -- Add sender_id if not present
  IF NOT incoming @> to_jsonb(sender_id) THEN
    incoming := incoming || to_jsonb(sender_id);
    UPDATE profiles 
    SET user_state = jsonb_set(current_state, '{incomingRequests}', incoming),
        updated_at = now()
    WHERE id = target_uid;
  END IF;
END;
$$;

-- 2. Accept Friend Request (Adds each other to friends array, clears from incoming/outgoing)
CREATE OR REPLACE FUNCTION accept_friend_request_rpc(target_uid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  my_id text;
  my_state jsonb;
  target_state jsonb;
BEGIN
  my_id := auth.uid()::text;
  IF my_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- 2a. Update MY profile (the one accepting)
  SELECT user_state INTO my_state FROM profiles WHERE id = my_id;
  my_state := jsonb_set(my_state, '{incomingRequests}', 
    COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(COALESCE(my_state->'incomingRequests', '[]'::jsonb)) elem WHERE elem::text != '"' || target_uid || '"'), '[]'::jsonb)
  );
  IF NOT COALESCE(my_state->'friends', '[]'::jsonb) @> to_jsonb(target_uid) THEN
    my_state := jsonb_set(my_state, '{friends}', COALESCE(my_state->'friends', '[]'::jsonb) || to_jsonb(target_uid));
  END IF;
  UPDATE profiles SET user_state = my_state, updated_at = now() WHERE id = my_id;

  -- 2b. Update TARGET profile (the one who sent it)
  SELECT user_state INTO target_state FROM profiles WHERE id = target_uid;
  target_state := jsonb_set(target_state, '{outgoingRequests}', 
    COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(COALESCE(target_state->'outgoingRequests', '[]'::jsonb)) elem WHERE elem::text != '"' || my_id || '"'), '[]'::jsonb)
  );
  IF NOT COALESCE(target_state->'friends', '[]'::jsonb) @> to_jsonb(my_id) THEN
    target_state := jsonb_set(target_state, '{friends}', COALESCE(target_state->'friends', '[]'::jsonb) || to_jsonb(my_id));
  END IF;
  UPDATE profiles SET user_state = target_state, updated_at = now() WHERE id = target_uid;
END;
$$;

-- 3. Decline Friend Request (Clears from incoming and outgoing)
CREATE OR REPLACE FUNCTION decline_friend_request_rpc(target_uid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  my_id text;
  my_state jsonb;
  target_state jsonb;
BEGIN
  my_id := auth.uid()::text;
  IF my_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT user_state INTO my_state FROM profiles WHERE id = my_id;
  my_state := jsonb_set(my_state, '{incomingRequests}', 
    COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(COALESCE(my_state->'incomingRequests', '[]'::jsonb)) elem WHERE elem::text != '"' || target_uid || '"'), '[]'::jsonb)
  );
  UPDATE profiles SET user_state = my_state, updated_at = now() WHERE id = my_id;

  SELECT user_state INTO target_state FROM profiles WHERE id = target_uid;
  target_state := jsonb_set(target_state, '{outgoingRequests}', 
    COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(COALESCE(target_state->'outgoingRequests', '[]'::jsonb)) elem WHERE elem::text != '"' || my_id || '"'), '[]'::jsonb)
  );
  UPDATE profiles SET user_state = target_state, updated_at = now() WHERE id = target_uid;
END;
$$;

-- 4. Remove Friend
CREATE OR REPLACE FUNCTION remove_friend_rpc(target_uid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  my_id text;
  my_state jsonb;
  target_state jsonb;
BEGIN
  my_id := auth.uid()::text;
  IF my_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT user_state INTO my_state FROM profiles WHERE id = my_id;
  my_state := jsonb_set(my_state, '{friends}', 
    COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(COALESCE(my_state->'friends', '[]'::jsonb)) elem WHERE elem::text != '"' || target_uid || '"'), '[]'::jsonb)
  );
  UPDATE profiles SET user_state = my_state, updated_at = now() WHERE id = my_id;

  SELECT user_state INTO target_state FROM profiles WHERE id = target_uid;
  target_state := jsonb_set(target_state, '{friends}', 
    COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(COALESCE(target_state->'friends', '[]'::jsonb)) elem WHERE elem::text != '"' || my_id || '"'), '[]'::jsonb)
  );
  UPDATE profiles SET user_state = target_state, updated_at = now() WHERE id = target_uid;
END;
$$;
