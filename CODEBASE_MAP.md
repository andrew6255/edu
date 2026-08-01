# Codebase Map

Last reviewed: 2026-07-31. This is the compact, implementation-light entry point for future work. Read this before opening source files; update it whenever routes, packages, persistence models, or deployment boundaries change.

## Product and architecture

Logic Lords is a multi-role education/gamification platform. Students study public and personal programs, play solo/multiplayer logic and math games, join classes, and progress through economy, battle-pass, realm, and Chrono Empires systems. Separate experiences exist for superadmins, admins, teachers, teaching assistants, and parents.

```text
Vite/React SPA (Vercel; optional Capacitor Android/iOS shells)
  |-- Supabase Auth
  |-- Supabase Postgres + RLS + Realtime + Storage (most product reads/writes)
  `-- Express API /api (AI tutoring, grading, OCR, program ingestion)
          `-- Postgres through Drizzle + external AI/OCR providers + local job files
```

This is a pnpm 11 / TypeScript 5.9 monorepo. React 19, Vite 7, Tailwind 4, Wouter, TanStack Query, Supabase JS, Express 5, Drizzle, and Zod are the core stack.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `artifacts/web-app/` | Primary SPA and deployable frontend; `src/main.tsx` → `src/App.tsx`. Includes Capacitor Android/iOS projects. |
| `artifacts/api-server/` | Express API; `src/index.ts` → `src/app.ts` → `src/routes/index.ts`. Bundled by esbuild to `dist/index.mjs`. |
| `artifacts/mockup-sandbox/` | Independent Vite design/prototyping sandbox; not part of the production app runtime. |
| `lib/api-spec/` | OpenAPI source and Orval config. Currently documents only health, so it is incomplete relative to Express routes. |
| `lib/api-client-react/` | Generated React Query client plus `setBaseUrl` / `setAuthTokenGetter`. |
| `lib/api-zod/` | Generated API Zod schemas/types consumed by the API. |
| `lib/db/` | Drizzle connection and ingestion-table schema; requires `DATABASE_URL`. It models only profiles + ingestion tables, not the full Supabase schema. |
| `supabase_schema.sql` | Main Supabase tables, functions, RLS, storage policies, and ingestion additions. |
| `fix_rls_recursion.sql` | RLS helper functions and replacement policies that avoid recursive policy evaluation. |
| `friend_request_rpc.sql` | Friend request/accept/decline/remove security-definer RPCs. |
| `enable_realtime.sql` | Adds selected tables to Supabase Realtime publication. |
| `scripts/` | Small workspace scripts package; currently only a hello script plus post-merge helper. |
| `tools/` | Python OCR/map-compilation utilities. |
| `attached_assets/` | Imported/reference assets and question-bank material. |
| `backups/`, `**/dist/`, `**/node_modules/` | Historical/generated/vendor content; do not treat as source of truth. |

## Frontend public surface

Top-level Wouter routes are declared in `artifacts/web-app/src/App.tsx`:

| Route | Audience / purpose |
| --- | --- |
| `/` | Public landing page |
| `/auth` | Supabase authentication and account flows |
| `/app` | Authenticated student shell |
| `/chrono/board/:board` | Chrono Empires board |
| `/superadmin` | Global administration and content ingestion/publishing |
| `/admin` | School/admin role panel |
| `/teacher` | Teacher role panel |
| `/ta` | Teaching-assistant role panel |
| `/parent` | Parent role panel |
| `/logic-preview` | Logic-games preview |

`AppPage.tsx` owns student in-app navigation (stateful views, not URLs): universe, program map, personal program, study sessions, classes, warmup, logic games, profile, emporium, notifications, friends, lobby, and party match. `AppShell.tsx` supplies navigation, account switching, notifications, presence, session-abandon handling, economy HUD, settings, and parent linking.

Provider hierarchy is Query Client → tooltips/confirmation → Auth → Session → router. `GlobalDataProvider` is mounted by the student page and preloads personal programs/subjects, logic nodes/progress, classes, Chrono state/inventory, and lobby state. Cross-feature navigation/state also uses `ll:*` browser events; the main contracts are `ll:setView`, `ll:openClassContent`, `ll:setPendingSession`, `ll:setOngoingWarmup`, `ll:personalProgramCreated`, `ll:personalProgramDeleted`, `ll:subjectsUpdated`, and `ll:openMyPrograms`.

Frontend domain logic lives in `artifacts/web-app/src/lib/*Service.ts` (and nearby helpers), grouped broadly as:

- Identity/roles: auth, users, admin, teacher, TA, parent, student, linking.
- Learning: public programs, personal programs/subjects, program maps/assets/progress, study sessions, question banks/generation, freeform review/grading, AI tutor, OCR/import.
- Classroom: classes, assignments/quizzes/progress, chat, notifications.
- Games/social: warmups, logic games, arena/duels, party/lobby, friends, sessions, leaderboard.
- Metagame: economy/shop/drops, inventory, battle pass, realms/upgrades, expeditions, Chrono Empires/board/tasks/cards/prestige/vault/rewards.

Shared UI primitives are in `components/ui/`; feature UI is under `components/{layout,settings,superadmin,universe,warmup}` and `views/`; individual games are under `games/`.

## HTTP API

All Express endpoints are under `/api`. No authentication middleware is mounted globally in `app.ts`; callers/controllers and deployment controls must supply any required trust boundary.

| Method and path | Purpose |
| --- | --- |
| `GET /api/healthz` | Health check |
| `GET/POST /api/program-ingestion` | List/create ingestion jobs |
| `GET /api/program-ingestion/:jobId` | Read a job |
| `POST /api/program-ingestion/:jobId/source` | Attach source file |
| `POST /api/program-ingestion/:jobId/run` | Run a pipeline stage |
| `PATCH /api/program-ingestion/:jobId/questions/:questionId` | Review/edit normalized question |
| `POST /api/program-ingestion/:jobId/publish` | Publish a completed job |
| `POST /api/program-ingestion/personal` | Start personal-program creation |
| `GET /api/program-ingestion/personal/:jobId/{status,debug}` | Personal-job status/debug |
| `POST /api/program-ingestion/extract-mcq` | Extract MCQs from text |
| `POST /api/program-ingestion/extract-iq-pdf` | Multipart question/answer PDF extraction |
| `POST /api/program-ingestion/iq-question-details` | Generate question details |
| `POST /api/program-ingestion/emoji` | Generate an emoji/icon suggestion |
| `POST /api/program-ingestion/enrich-questions` | AI enrichment |
| `POST /api/freeform-grading/grade` | Grade a freeform answer |
| `POST /api/handwriting-recognition/recognize` | Recognize handwritten math |
| `POST /api/symbol-recognition/recognize` | Recognize a symbol |
| `POST /api/ai-tutor/evaluate-work` | Evaluate student work |
| `POST /api/ai-tutor/chat` | Tutor chat |
| `GET /api/ai-tutor/status` | Provider/config status |

Each API feature follows routes → validation/controller → service → provider(s). Program ingestion additionally has a repository, file store, in-process job queue, pipeline/stage providers, segmentation/normalization/anomaly logic, and Python PDF extraction. Job files default to `artifacts/api-server/.data/program-ingestion`; this is ephemeral unless the host mounts durable storage.

## Supabase persistence contracts

Auth identities are extended by `profiles`; roles are `student`, `teacher_assistant`, `teacher`, `admin`, `superadmin`, and `parent`. The main relational tables are:

- Core/economy/content: `profiles`, `user_economy`, `public_programs`, `draft_programs`, `assets`.
- Logic learning: `logic_game_nodes_public`, `logic_game_nodes_draft`, `logic_game_questions_public`, `logic_game_questions_draft`, `logic_game_progress`, `question_progress`.
- Generic document layer: `user_docs` (owner-scoped) and `global_docs` (shared collections). Many game/social/Chrono features encode their domain data here, so service modules are the contract for document keys and payload shapes.
- School/classroom: `admin_teacher_assignments`, `classes`, `class_members`, `parent_student_links`, `linking_codes`, `class_content`, `quiz_attempts`, `class_question_progress`, `chat_rooms`, `chat_messages`.
- Ingestion: `program_ingestion_jobs`, `program_ingestion_drafts`, `program_ingestion_questions`, `program_ingestion_chat_messages`, `program_ingestion_assets`.

Public RPC surface used by the SPA: `admin_update_user_role`, `admin_delete_user`, `admin_delete_student_and_parent`, `send_friend_request_rpc`, `accept_friend_request_rpc`, `decline_friend_request_rpc`, and `remove_friend_rpc`. RLS helper functions in the schema/fix script centralize role, class membership, teacher, admin, and parent/student checks. Storage uses the `program-assets` bucket.

Most frontend persistence bypasses the Express API and calls Supabase directly. Realtime subscriptions are used for profile changes, document collections, lobbies, notifications, challenges, and other live game/social state.

## Configuration and deployment

Root commands:

- `pnpm build`: TypeScript project build/typecheck, then builds all workspace packages that define `build`.
- `pnpm typecheck`: shared-library build plus artifact/script typechecks.
- Per-package: `pnpm --filter @workspace/web-app dev|build|test`; `pnpm --filter @workspace/api-server dev|build|test`.

Frontend environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_SERVER_URL`, `VITE_BASE_PATH`, `VITE_SENTRY_DSN`, `VITE_APP_VERSION`, `VITE_OCR_SERVER_URL`, plus currently referenced `VITE_GROQ_API_KEY` and `VITE_SUPABASE_SERVICE_ROLE_KEY`.

API/database environment: `DATABASE_URL`, `PORT` (default 5000), `NODE_ENV`, `LOG_LEVEL`, `SENTRY_DSN`, `APP_VERSION`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `AI_TUTOR_API_KEY`, `AI_TUTOR_BASE_URL`, `AI_TUTOR_MODEL`, provider/model switches prefixed `PROGRAM_INGESTION_` and `FREEFORM_GRADING_`, and OCR switches prefixed `HANDWRITING_OCR_` / `SYMBOL_RECOGNITION_`.

`vercel.json` only pins the pnpm install command. The repository itself does not declare Vercel build/output routing or a Vercel serverless entry for Express, so the Vercel project dashboard settings (root directory/build command/output directory) and the actual API host/rewrite remain external configuration. The SPA build copies `index.html` to `404.html` for history fallback. Capacitor builds use the same `web-app/dist` output.

Security boundary: every `VITE_*` value is bundled into client JavaScript. `VITE_SUPABASE_SERVICE_ROLE_KEY` and `VITE_GROQ_API_KEY` therefore must not hold privileged production secrets; privileged calls belong behind the API/server environment. RLS is the primary authorization boundary for direct browser-to-Supabase traffic.

## Generated and source-of-truth rules

- Edit `lib/api-spec/openapi.yaml`, then regenerate API client/Zod output; do not hand-edit `lib/*/src/generated/` or `dist/`.
- Treat `supabase_schema.sql` plus the supplemental SQL scripts as database intent, while checking the live Supabase project for migration drift (there is no timestamped migrations directory here).
- Treat `artifacts/web-app/src/` and `artifacts/api-server/src/` as runtime source. Ignore `SuperAdminPage.tsx.corrupted`, backups, compiled output, and copied attached assets unless explicitly recovering/comparing history.
- Add new frontend data access to a domain service rather than directly inside a component where practical. Preserve the existing RLS-aware Supabase boundary.
- When an API route changes, update both Express routing/validation and the OpenAPI/codegen surface; the spec is currently behind and should not be assumed complete.

## Fast orientation by task

| Task | Start here |
| --- | --- |
| App boot/routing/auth | `web-app/src/App.tsx`, `contexts/AuthContext.tsx`, `pages/AppPage.tsx` |
| Student shell/navigation | `components/layout/AppShell.tsx`, `views/` |
| Supabase query or realtime bug | Relevant `src/lib/*Service.ts`, `src/lib/supabaseDocStore.ts`, then SQL/RLS |
| Role/admin/class feature | Role page + `adminService`, `teacherService`, `taService`, `parentService`, `studentService`, `classService` |
| Program/content work | `ProgramMapView`, `PersonalProgramView`, program services, `public_programs`/`draft_programs` |
| AI/OCR/import | Frontend service → matching API module; ingestion starts at `modules/program-ingestion/pipeline.ts` |
| Game/social feature | `views/`, `games/`, matching service and `types/`; much state is in document tables |
| Database/RLS | `supabase_schema.sql`, then `fix_rls_recursion.sql` and RPC scripts |
| Deployment | root `vercel.json`, package build scripts, `web-app/vite.config.ts`, API `build.mjs`, external Vercel project settings |

