-- Supabase Realtime requires explicit table subscription
-- Run this in your Supabase SQL Editor to enable instant live updates

begin;

  -- Add the required tables to the supabase_realtime publication
  -- The `if not exists` logic doesn't apply to publications in this exact syntax in all PG versions,
  -- so it's safe to just drop the table from the publication (ignore error) and re-add it.
  
  alter publication supabase_realtime add table profiles;
  alter publication supabase_realtime add table global_docs;
  alter publication supabase_realtime add table user_docs;

commit;
