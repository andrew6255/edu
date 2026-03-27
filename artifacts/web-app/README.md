# Logic Lords — Web App

This package is the React + Vite client for Logic Lords.

## Run

From repo root:

```bash
pnpm -C artifacts/web-app dev
```

Build:

```bash
pnpm -C artifacts/web-app build
```

Typecheck:

```bash
pnpm -C artifacts/web-app typecheck
```

## Program Map + Program Practice

The student Program experience lives primarily in:

- `src/views/ProgramMapView.tsx`

It implements:

- Chapters roadmap → subsections roadmap → question types
- Practice as a full-page screen
- Practice modes:
  - Solo Practice
  - Ranked (trophies)
  - Play a Friend (join code)

### Data sources

Sample question bank/annotations are loaded from `public/questionBanks/`.

- `public/questionBanks/program.sample.v3.json`
- `public/questionBanks/program.annotations.sample.v3.json`

### Progress

Progress is stored per-user in Firestore:

- `users/{uid}/program_progress/{programId}`

### Friend sessions

Play-a-friend sessions are stored in:

- `programFriendSessions/{code}`

Rules are defined in repo root `firestore.rules`.
