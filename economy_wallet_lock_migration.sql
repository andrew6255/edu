-- Final shared-wallet security cutover.
-- Run only after economy_ledger_migration.sql and the matching API/web builds
-- are deployed and verified. New-wallet inserts and wallet reads remain
-- available to authenticated users; direct balance updates do not.

begin;

drop policy if exists user_economy_update_own on user_economy;

commit;
