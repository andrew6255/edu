# Logic Lords — Replit Workspace

## Overview

Gamified education platform — "Logic Lords". Students battle through curriculum content via warmup games, hex universe maps, and arena combat. Teachers/admins manage classes via a dedicated dashboard.

Built as a pnpm monorepo: React/Vite web app (client), Express API (server), Firebase for auth + Firestore.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 19 + Vite 7 + Tailwind 4 + Radix UI (shadcn) + Wouter routing
- **Auth / Database**: Firebase (logiclords-mvp project) — auth + Firestore
- **API framework**: Express 5 (currently minimal; game logic is Firebase-driven)
- **Database**: PostgreSQL + Drizzle ORM (for Express API)
- **Build**: esbuild (API), Vite (web app)

## Firebase Config

Project: `logiclords-mvp`
- apiKey: `AIzaSyBaNWmSxGWq3q3G7qm78Aj-npdGTaAy3tM`
- authDomain: `logiclords-mvp.firebaseapp.com`
- projectId: `logiclords-mvp`

## Structure

```text
artifacts/
├── api-server/          # Express 5 API (minimal for now)
├── mockup-sandbox/      # Vite design sandbox
└── web-app/             # React + Vite — Logic Lords web app
    └── src/
        ├── lib/
        │   ├── firebase.ts          # Firebase app/auth/db init
        │   └── userService.ts       # Firestore user CRUD, level computation
        ├── contexts/
        │   └── AuthContext.tsx      # Firebase auth state + userData
        ├── pages/
        │   ├── Landing.tsx          # Public landing page
        │   ├── AuthPage.tsx         # Login / Register / Google OAuth
        │   └── AppPage.tsx          # Authenticated app container
        ├── components/
        │   └── layout/
        │       └── AppShell.tsx     # Top HUD + bottom nav + side menu
        ├── views/
        │   ├── HexUniverseView.tsx  # Subject hex grid map
        │   ├── CurriculumView.tsx   # Curriculum list + chapters + skill tree
        │   ├── WarmupView.tsx       # Game category selection + game launch
        │   └── ProfileView.tsx      # User stats, badges, high scores
        └── games/
            ├── QuickMathGame.tsx    # MCQ math (60s timed)
            ├── PyramidGame.tsx      # Number pyramid fill
            ├── BlockPuzzleGame.tsx  # Tetris-style dropper
            ├── FlipNodesGame.tsx    # Parity flip puzzle
            ├── FifteenGame.tsx      # 15-tile sliding puzzle
            └── SequenceGame.tsx     # Number sequence completion
lib/
├── api-spec/            # OpenAPI spec + Orval codegen
├── api-client-react/    # Generated React Query hooks
├── api-zod/             # Generated Zod schemas
└── db/                  # Drizzle ORM schema
scripts/                 # Utility scripts
```

## Routes (web app)

- `/` — Landing page (public)
- `/auth` — Login/Register/Google (redirects to /app if signed in)
- `/app` — Main app (requires auth, redirects to / if not)

## In-app Views (via bottom nav)

- **Universe** — Hex subject map → Curriculum view
- **Learn** (Curriculum) — Curriculum list → chapters → skill tree objectives
- **Warmup** — Game category filter + 18 mini-games; Solo / Ranked / Friend modes
- **Arena** — Battle Arena: hub with 4 AI enemies, full RPG battle screen, streak system
- **Profile** — XP/level/gold/streak, badges, personal bests

## Warmup Games Implemented

1. **Quick Math** — 60s timed MCQ, streaks, +10/-3 scoring
2. **Advanced Math** — Harder variant
3. **Number Pyramid** — Fill pyramid via numpad
4. **Block Puzzle** — Tetromino dropper (keyboard + touch)
5. **Flip Nodes** — 5×5 parity flip, 5 levels
6. **15 Puzzle** — Sliding tile solver
7. **Sequence** — 8-round number pattern completion

## User Data (Firestore)

Collection: `users/{uid}`

Fields: `firstName`, `lastName`, `username`, `email`, `economy` `{gold, global_xp, streak}`, `arenaStats` `{wins, losses, highestStreak}`, `curriculums`, `inventory` `{stories, badges, banners, mapThemes}`, `equipped`, `high_scores`, `analytics`

New users start with 200 gold (to enable Ranked mode from day 1).

## Economy

- Gold, XP, streak tracked in Firestore
- `computeLevel(xp)` → level 1-9, title (Initiate → Logic Lord)
- High scores per game tracked in `high_scores` map

## Key Packages

```
web-app:  firebase, react, wouter, tailwindcss, @radix-ui/*, framer-motion
api-server: express, @workspace/db, @workspace/api-zod
```

## Root Scripts

- `pnpm run build` — typecheck then build all packages
- `pnpm run typecheck` — tsc --build across all project references
