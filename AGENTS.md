# Agent and contributor guide

This file is the handoff contract for automated agents and developers working in this repository.

## Before editing

1. Read `README.md`, `CODEBASE_MAP.md`, and, for database or deployment work, `docs/RELEASE_CUTOVER.md`.
2. Run `git status --short`. Preserve unrelated and unfinished changes; never clean or reset the whole worktree.
3. Search with `rg` before assuming a file or service is unused.
4. Identify the active implementation in `artifacts/web-app/src/App.tsx`. Do not revive removed prototypes or old role/classroom implementations.

## Sources of truth

- Frontend: `artifacts/web-app/src`.
- API: `artifacts/api-server/src`.
- Active role panels: `TeacherPage.tsx`, `SuperAdminPage.tsx`, and `UnifiedRolePages.tsx`.
- Active classroom model: `classroomService.ts` and its classroom components, backed by scoped `global_docs` collections.
- Baseline database intent: `supabase_schema.sql`; incremental changes: named root migration files.
- Release order and authority locks: `docs/RELEASE_CUTOVER.md`.
- API contract source: `lib/api-spec/openapi.yaml`; generated output must be regenerated, not hand-edited.

## Boundaries that must remain intact

- Never put secrets in a `VITE_*` variable or browser code.
- Never use the service-role key from the frontend.
- Supabase is the only store for superadmin credentials. Never reintroduce an environment variable that overrides a stored password, and never hardcode the account's password in source, logs, or documentation.
- Browser access must remain protected by RLS; role checks in React are presentation only.
- Privileged user management, wallet mutations, impersonation, confidential answers, and final progress authority belong on the API/server side.
- Classroom storage is private and uses signed URLs. Validate both database scope and storage-object ownership.
- Reward mutations need an idempotency key and ledger entry.
- Parent data is limited to linked children; admins are limited to assigned teachers; TAs are limited to assigned classrooms.

## Change workflow

- Keep changes within the requested scope and avoid drive-by rewrites.
- Extend an existing service/component before creating a parallel architecture.
- For API changes, update validation, controller/service, tests, and OpenAPI together.
- For schema changes, make the SQL rerunnable where practical and document its position in the release sequence.
- For mobile UI changes, verify a narrow viewport, touch targets, safe areas, fixed bars, modals, keyboards, and file inputs.
- Remove generated or runtime data instead of committing it. `.data`, `dist`, logs, coverage, local environments, dependencies, and backups are ignored.

## Verification

Use the smallest relevant tests during development, then finish with:

```bash
pnpm typecheck
pnpm --filter @workspace/web-app test
pnpm --filter @workspace/api-server test
pnpm build
git diff --check
```

If Vitest reports a missing platform-specific Rollup binary, dependencies were installed from another operating system. Reinstall dependencies in the current OS rather than changing application code.

Database changes also require manual role-based smoke tests described in `docs/RELEASE_CUTOVER.md`. A successful TypeScript build does not validate RLS or storage policies.

## Handoff

At completion, report files changed, checks run, checks that could not run, database/manual steps still required, and any security or product decision that remains unresolved. Update documentation whenever routes, packages, active data models, environment ownership, or deployment order changes.
