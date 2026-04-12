# Firebase to Supabase Migration

## Safe rollout order

1. Create Supabase tables using `supabase_schema.sql`.
2. Create a public Storage bucket named `program-assets`.
3. Add Supabase env vars to `artifacts/web-app/.env.local`.
4. Install web app dependency: `@supabase/supabase-js`.
5. Start with an empty Supabase project and create fresh data there.
6. Swap one feature at a time from Firebase to Supabase:
   - programs
   - logic games
   - profiles/economy
   - progress
   - auth (last)

## Recommended path for this project

You decided to discard all legacy Firebase data.

That means you do not need to migrate:

- Firebase Auth users
- Firestore user profiles
- user economy
- progress
- social data
- notifications
- old content
- old uploaded assets

The goal is simply:

- keep the Supabase schema ready
- keep the Supabase storage bucket ready
- keep the app writing new data to Supabase going forward
- let new users and new content start from zero

## Required env vars

### Frontend (`artifacts/web-app/.env.local`)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Migration script / server-only
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_STORAGE_BUCKET`
- `GOOGLE_APPLICATION_CREDENTIALS` (path to Firebase service account JSON)

## One-time importer implemented

- Script: `scripts/migrate-firebase-to-supabase.mjs`
- Package script: `pnpm --filter @workspace/scripts run migrate:supabase`
- Dry run: `pnpm --filter @workspace/scripts run migrate:supabase -- --dry-run`

This importer is now optional for this project because you chose a clean-slate rollout.

### What it migrates
- Firestore `public_programs` -> Supabase `public_programs`
- Firestore `draft_programs` -> Supabase `draft_programs`
- Firestore `logic_game_nodes_public` -> Supabase `logic_game_nodes_public`
- Firestore `logic_game_nodes_draft` -> Supabase `logic_game_nodes_draft`
- Firestore `logic_game_questions_public` -> Supabase `logic_game_questions_public`
- Firestore `logic_game_questions_draft` -> Supabase `logic_game_questions_draft`
- Firestore `users` -> Supabase `profiles`
- Firestore `users.economy` -> Supabase `user_economy`
- Firebase Storage `programAssets/**` -> Supabase Storage bucket `program-assets`

### What it intentionally does not migrate yet
- Notifications subcollections
- Friend request / social realtime state
- Challenge/session realtime docs
- Curriculum progress into `question_progress`

Curriculum progress is still preserved inside `profiles.user_state` because the live app now reads it through the migrated `userService` path.

## Safe run sequence

1. Confirm the latest `supabase_schema.sql` has been run.
2. Confirm Supabase bucket `program-assets` exists.
3. Confirm frontend env vars point to the correct Supabase project.
4. Start creating fresh data in the app.

## Optional legacy import path

Only use this if you later decide you want old Firebase data after all.

1. Set required server-only env vars in your shell.
2. Preview first:

```bash
pnpm --filter @workspace/scripts run migrate:supabase -- --dry-run
```

3. Review the final JSON summary printed by the script.
4. If the counts look correct, run the real import:

```bash
pnpm --filter @workspace/scripts run migrate:supabase
```

## Verification checklist

For the clean-slate rollout, verify all of the following before removing any Firebase dependency:

1. A newly registered user gets a fresh profile in Supabase.
2. Google Sign-In creates a fresh user record in Supabase if the user does not exist yet.
3. New programs can be created and saved from the admin panel.
4. New logic game content can be created and loaded.
5. New uploaded program images render from Supabase Storage URLs.
6. Fresh progress/economy updates persist correctly for new users.

## Notes

- Keep Firebase live during migration.
- Do not remove Firebase services until the equivalent Supabase service is verified in production.
- Keep notifications/friends/challenge realtime on Firebase until a dedicated Supabase realtime design is implemented.
- The current app is already capable of creating new Supabase-backed user records from an empty starting point.

## Current local foundation added
- `artifacts/web-app/src/lib/supabase.ts`
- `artifacts/web-app/.env.example`
- `supabase_schema.sql`
