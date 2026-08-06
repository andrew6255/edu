# Education game platform

This repository contains a multi-role education platform with a shared game economy. Students study, complete classroom work, and earn resources used across Chrono Empires and future games. Teachers, teaching assistants, school admins, parents, and superadmins use role-specific panels built on the same classroom and identity model.

The current product name is not final. Do not spread the working names "Logic Lords" or "IQ Games" into new identifiers or store assets until branding is decided.

## Start here

1. Read [CODEBASE_MAP.md](./CODEBASE_MAP.md) for routes, packages, data boundaries, and task entry points.
2. Read [docs/RELEASE_CUTOVER.md](./docs/RELEASE_CUTOVER.md) before changing Supabase policies or deploying authority-lock migrations.
3. Read [AGENTS.md](./AGENTS.md) for repository rules and the completion checklist.
4. Inspect `git status` before editing. This project may contain intentional work in progress.

The active runtime consists of:

- `artifacts/web-app`: React/Vite web app and Capacitor Android/iOS shells.
- `artifacts/api-server`: Express API for privileged account operations, economy authority, AI, OCR, grading, and ingestion.
- Supabase: authentication, Postgres, RLS, Realtime, and private/public storage.
- `lib/*`: shared database, OpenAPI, generated schema, and client packages.

The old role pages and mockup sandbox have been removed. `/admin`, `/parent`, and `/ta` use `UnifiedRolePages.tsx`; the active classroom implementation uses the document-based `classroomService` model everywhere.

## Local setup

Requirements: Node.js 22 and pnpm 11.17. Use the same operating system for dependency installation and execution; native Vite/Rollup packages installed on Windows do not work inside WSL, and vice versa.

```bash
pnpm install --frozen-lockfile
cp artifacts/api-server/.env.example artifacts/api-server/.env.local
cp artifacts/web-app/.env.example artifacts/web-app/.env.local
pnpm dev
```

The API defaults to port 3001 and Vite normally uses port 5173. Add exact production web origins to `CORS_ALLOWED_ORIGINS` before deployment.

Environment ownership is a security boundary:

- Browser-safe values belong in `artifacts/web-app/.env.local` and use `VITE_*`.
- Secrets belong in `artifacts/api-server/.env.local` without a `VITE_` prefix.
- `SUPABASE_SERVICE_ROLE_KEY`, database credentials, and AI provider keys must never be exposed to the web build or committed.
- Superadmin credentials live only in Supabase, exactly like every other account. There is no environment override, so local and hosted deployments that point at the same Supabase project share one username and password. Change the password with `pnpm --filter @workspace/api-server superadmin:set-password`, or from the Supabase dashboard.
- The root `.env.local` is only for tooling that explicitly reads it. Prefer package-local environment files for runtime configuration.

## Common commands

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm --filter @workspace/web-app test
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/web-app dev
pnpm --filter @workspace/api-server dev
```

Build output, test coverage, API ingestion scratch files, logs, dependencies, local environments, and local backups are ignored. Do not commit them.

## Development rules

- Put frontend data access in a domain service under `artifacts/web-app/src/lib`, not directly in a component where avoidable.
- Treat RLS as the authorization boundary for browser-to-Supabase calls. UI filtering is not authorization.
- Keep service-role, managed-account, role-change, wallet, impersonation, and confidential-answer operations server-side.
- Do not reintroduce the old relational classroom UI. Compatibility tables may remain in SQL only while migration requires them.
- Homework attachments and submissions use the private `classroom-homework` bucket and signed URLs. Students may edit work before the deadline; authorized teachers can see drafts live.
- Economy rewards must be idempotent and ledger-backed. Games consume the same coins, gems, energy, XP, inventory, and cards rather than creating isolated wallets.
- Update the Express route, validation, service, tests, and OpenAPI/code generation together when changing an API contract.
- Add SQL changes as reviewable migration files. Apply migrations before authority locks and never assume a lock is reversible without checking its SQL.
- Design all role panels mobile-first: safe areas, bottom navigation, 44px touch targets, narrow-screen wrapping, and native file-picker behavior.

## Database and release workflow

`supabase_schema.sql` is the baseline schema. The root migration scripts represent incremental production changes, and some `*_lock_migration.sql` files deliberately remove legacy browser permissions. Follow [the cutover order](./docs/RELEASE_CUTOVER.md); do not run all SQL files alphabetically.

Before deploying, type-check and build both packages, then smoke-test every role. Validate student draft visibility, classroom membership scope, private file access, parent-child scope, admin-teacher scope, and economy idempotency. Deploy the API and web app from the same revision before enabling final locks.

## Mobile apps

The web app already contains Capacitor Android and iOS projects. After a successful web build:

```bash
pnpm --filter @workspace/web-app build
pnpm --dir artifacts/web-app exec cap sync
pnpm --dir artifacts/web-app exec cap open android
# macOS with Xcode is required for iOS:
pnpm --dir artifacts/web-app exec cap open ios
```

Before store release, settle the product name and update the app ID/name, icons, splash screens, signing, privacy/support URLs, Egyptian privacy and guardian-consent disclosures, and store metadata. Test whiteboards, multiple-file submissions, downloads, keyboard behavior, and safe areas on physical iOS and Android devices.

## Current priorities

- Complete production cutover and role-by-role smoke tests.
- Decide final branding before native-store packaging.
- Finalize the Chrono Empires redesign and at least two alternative games sharing one economy.
- Extend automated coverage for classroom authorization, live submissions, account authority, and reward idempotency.
- Bring `lib/api-spec/openapi.yaml` up to parity with the Express API.

When a decision changes architecture or release procedure, update this README, `CODEBASE_MAP.md`, and the relevant release document in the same change.
