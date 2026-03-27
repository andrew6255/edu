# Logic Lords (Edu Monorepo)

## What this repo is

A pnpm monorepo for **Logic Lords** — a gamified education platform.

- **Web app**: `artifacts/web-app` (React + Vite + Firebase)
- **API server**: `artifacts/api-server` (Express)
- **Shared libs**: `lib/*`
- **Scripts**: `scripts/*`
- **Content/tooling**: `tools/*` and sample JSON files in repo root

If you are looking for the **Program Map / Program MCQ practice** work, it lives in:

- `artifacts/web-app/src/views/ProgramMapView.tsx`
- `artifacts/web-app/src/lib/programQuestionBank.ts`
- `artifacts/web-app/src/lib/programProgress.ts`
- `artifacts/web-app/src/lib/programFriendService.ts`
- `artifacts/web-app/src/types/programFriend.ts`
- `firestore.rules`

## Requirements

- **Node.js**: see `replit.md` (currently Node 24)
- **Package manager**: **pnpm** (workspace uses `catalog:` versions)

## Quickstart

Install deps:

```bash
pnpm install
```

Typecheck everything:

```bash
pnpm run typecheck
```

Build everything:

```bash
pnpm run build
```

Run the web app locally:

```bash
pnpm -C artifacts/web-app dev
```

## Firestore rules

Rules are in `firestore.rules`.

To deploy via script:

- Set `FIREBASE_SERVICE_ACCOUNT_JSON` env var to a full Firebase service account JSON string.
- Run:

```bash
node scripts/deploy-firestore-rules.mjs
```

## Repo structure (high level)

```text
artifacts/
  api-server/
  mockup-sandbox/
  web-app/
lib/
scripts/
tools/
firestore.rules
pnpm-workspace.yaml
replit.md
```

## Where sample content lives

Root-level `*.sample*.json` files are example inputs/outputs for the content pipeline:

- `toc.sample*.json` — sample table of contents
- `blueprint.sample*.json` — sample blueprint output
- `program.sample*.json` — sample chapter/program question bank

The runtime sample Program question bank used by the web app is in:

- `artifacts/web-app/public/questionBanks/*`
