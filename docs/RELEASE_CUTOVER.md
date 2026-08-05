# Release cutover

This sequence keeps the current browser build working until its replacement API
is online. Run each SQL file as a complete query in the Supabase SQL editor.

## 1. Pre-deployment database changes

Run or rerun in this order:

1. `account_security_migration.sql`
2. `classroom_rls.sql`
3. `classroom_homework_migration.sql`
4. `teacher_student_roster_migration.sql`
5. `friend_request_rpc.sql`
6. `economy_ledger_migration.sql`
7. `admin_server_authority_migration.sql`
8. `profile_privacy_migration.sql`
9. `logic_games_superadmin_rls_migration.sql`
10. `view_write_grant_lockdown_migration.sql`

`program_answer_confidentiality_migration.sql` is already installed and does not
need to be rerun unless its SQL changes. Its grant block was corrected, so rerun
it (or step 10, which is enough on its own) to pick up the fix.

Step 10 must run after any step that creates or replaces `profile_directory` or
`public_programs_sanitized`. Supabase default privileges grant ALL on new objects
in `public` to `anon`/`authenticated`, and both views are owner-run, so a
recreated view is writable with base-table RLS bypassed until the grants are
stripped again.

No database change is needed for the personalized worksheet UI on public
programs. `public_programs_sanitized.builder_spec` stays null, and the API server
serves the student-safe program tree from `/api/economy/program-builder-spec`
(structure and prompts only) with authored answers behind
`/api/economy/program-answer-reveal`. Both require a signed-in user and read the
authored tree with the service role, so the API server and web app must be
deployed from the same revision (step 2).

## 2. Deploy together

Deploy the API server and web application from the same revision. The API runtime
must have `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`. The web build must have only
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_SERVER_URL`.
Never place the service-role key in a `VITE_` variable.

Set API `CORS_ALLOWED_ORIGINS` to a comma-separated list of the exact production
web origins, for example `https://app.example.com,https://www.example.com`.
Capacitor localhost origins are allowed by the server automatically.

Before continuing, smoke-test all of these roles:

- Student: email login, username login, open classroom homework, create two
  sheets, upload two files, rename/delete work, and confirm autosave.
- Teacher: create an empty classroom, add participants afterward, create PDF
  homework with a deadline, and view a student's live draft.
- Admin: see only assigned teachers and their new classrooms, inspect a
  classroom, create a TA, and view/adjust an in-scope student's wallet.
- Parent: select a linked child, open the child's new classroom, and see live
  homework progress.
- TA: open an assigned new classroom and see homework work-in-progress.
- Superadmin: create/delete a managed test account and confirm the action audit.
- Games: earn a study reward, start/cancel matchmaking, finish one match, and
  verify that repeating a reward request does not pay twice.

## 3. Final authority locks

Only after every smoke test above passes, run:

1. `program_answer_confidentiality_lock_migration.sql`
2. `profile_privacy_lock_migration.sql`
3. `program_progress_authority_lock_migration.sql`
4. `multiplayer_session_lock_migration.sql`
5. `economy_wallet_lock_migration.sql`

These are cutover locks, not data migrations. They remove the old browser write
paths after the server-owned replacements are proven live. Each file is wrapped
in a transaction and checks its prerequisites before changing access.

## 4. Mobile release gate

The repository already contains Capacitor iOS and Android projects, safe-area
layout primitives, bottom navigation, 44px touch targets, and iOS input zoom
protection. Before App Store or Play Store submission, decide the final product
name and branding, then update `capacitor.config.ts`, the web title/favicon, app
icons, splash screens, bundle identifiers if needed, privacy policy URL, support
URL, store screenshots, and Egyptian data/guardian-consent disclosures.

Run a physical-device pass on a small iPhone, a large iPhone, a narrow Android,
and an Android tablet. Whiteboards should be tested with touch and stylus, and
file upload/download should be tested through each platform's native document
picker.
