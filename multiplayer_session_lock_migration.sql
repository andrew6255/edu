-- Run only after the updated API and web app have been deployed and tested.
-- The server functions are installed by economy_ledger_migration.sql.
-- These restrictive policies leave unrelated global_docs collections working
-- while preventing authenticated browsers from forging paid queue/session data.

drop policy if exists global_docs_matchmaking_insert_server_only on global_docs;
create policy global_docs_matchmaking_insert_server_only on global_docs
as restrictive for insert to authenticated
with check (collection <> 'matchmakingQueue');

drop policy if exists global_docs_matchmaking_update_server_only on global_docs;
create policy global_docs_matchmaking_update_server_only on global_docs
as restrictive for update to authenticated
using (collection <> 'matchmakingQueue')
with check (collection <> 'matchmakingQueue');

drop policy if exists global_docs_matchmaking_delete_server_only on global_docs;
create policy global_docs_matchmaking_delete_server_only on global_docs
as restrictive for delete to authenticated
using (collection <> 'matchmakingQueue');

drop policy if exists global_docs_game_sessions_insert_server_only on global_docs;
create policy global_docs_game_sessions_insert_server_only on global_docs
as restrictive for insert to authenticated
with check (collection <> 'gameSessions');

drop policy if exists global_docs_game_sessions_update_server_only on global_docs;
create policy global_docs_game_sessions_update_server_only on global_docs
as restrictive for update to authenticated
using (collection <> 'gameSessions')
with check (collection <> 'gameSessions');

drop policy if exists global_docs_game_sessions_delete_server_only on global_docs;
create policy global_docs_game_sessions_delete_server_only on global_docs
as restrictive for delete to authenticated
using (collection <> 'gameSessions');

-- Logic-game challenges still use their separate legacy match service. Only
-- warm-up challenges (including older rows without an explicit kind) are
-- protected by this migration.
drop policy if exists global_docs_warmup_challenges_insert_server_only on global_docs;
create policy global_docs_warmup_challenges_insert_server_only on global_docs
as restrictive for insert to authenticated
with check (
  collection <> 'challenges'
  or coalesce(data->>'kind','warmup') <> 'warmup'
);

drop policy if exists global_docs_warmup_challenges_update_server_only on global_docs;
create policy global_docs_warmup_challenges_update_server_only on global_docs
as restrictive for update to authenticated
using (
  collection <> 'challenges'
  or coalesce(data->>'kind','warmup') <> 'warmup'
)
with check (
  collection <> 'challenges'
  or coalesce(data->>'kind','warmup') <> 'warmup'
);

drop policy if exists global_docs_warmup_challenges_delete_server_only on global_docs;
create policy global_docs_warmup_challenges_delete_server_only on global_docs
as restrictive for delete to authenticated
using (
  collection <> 'challenges'
  or coalesce(data->>'kind','warmup') <> 'warmup'
);

insert into app_schema_migrations(migration_key,details)
values(
  'multiplayer_session_lock_v1',
  jsonb_build_object('description','Server-only matchmaking queue and multiplayer session writes')
)
on conflict(migration_key) do update
set applied_at=now(),details=excluded.details;
