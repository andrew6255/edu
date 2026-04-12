import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FIREBASE_STORAGE_BUCKET',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

let serviceAccount = null;
try {
  const raw = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  serviceAccount = JSON.parse(raw);
} catch {
  serviceAccount = null;
}
if (!serviceAccount) {
  console.error('Failed to load GOOGLE_APPLICATION_CREDENTIALS JSON.');
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const firestore = getFirestore();
const firebaseStorage = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const summary = {
  dryRun: DRY_RUN,
  programs: { public: 0, draft: 0 },
  logicGames: { publicNodes: 0, draftNodes: 0, publicQuestions: 0, draftQuestions: 0 },
  users: { profiles: 0, economies: 0, skippedCurriculumProgressRows: 0 },
  assets: { discovered: 0, copied: 0 },
};

function nowIso() {
  return new Date().toISOString();
}

async function readCollection(name) {
  const snap = await firestore.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function upsertRows(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  if (DRY_RUN) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

function mapProgramRow(row) {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : String(row.id),
    subject: typeof row.subject === 'string' ? row.subject : 'mathematics',
    grade_band: typeof row.grade_band === 'string' ? row.grade_band : null,
    cover_emoji: typeof row.coverEmoji === 'string' ? row.coverEmoji : null,
    builder_spec: row.builderSpec ?? null,
    toc: row.toc ?? null,
    annotations: row.annotations ?? null,
    program_meta: row.programMeta ?? null,
    question_banks_by_chapter: row.questionBanksByChapter ?? null,
    ranked_total_question_count: typeof row.rankedTotalQuestionCount === 'number' ? row.rankedTotalQuestionCount : 0,
    deleted_at: row.deletedAt ?? null,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
  };
}

function mapLogicNode(row) {
  return {
    id: String(row.id),
    iq: typeof row.iq === 'number' ? row.iq : 0,
    label: typeof row.label === 'string' ? row.label : '',
    sort_order: typeof row.order === 'number' ? row.order : 0,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    published_at: typeof row.publishedAt === 'string' ? row.publishedAt : null,
  };
}

function mapLogicQuestions(nodeId, row) {
  const questions = Array.isArray(row.questions) ? row.questions : [];
  return questions.map((q, idx) => ({
    node_id: String(nodeId),
    question_id: String(q.id ?? `q_${idx + 1}`),
    prompt_blocks: q.promptBlocks ?? null,
    prompt_raw_text: q.promptRawText ?? null,
    prompt_latex: q.promptLatex ?? null,
    interaction: q.interaction ?? null,
    time_limit_sec: typeof q.timeLimitSec === 'number' ? q.timeLimitSec : 0,
    iq_delta_correct: typeof q.iqDeltaCorrect === 'number' ? q.iqDeltaCorrect : 0,
    iq_delta_wrong: typeof q.iqDeltaWrong === 'number' ? q.iqDeltaWrong : 0,
    sort_order: idx,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    published_at: typeof row.publishedAt === 'string' ? row.publishedAt : null,
  }));
}

function mapProfile(row) {
  return {
    id: String(row.id),
    email: typeof row.email === 'string' ? row.email : null,
    username: typeof row.username === 'string' ? row.username : null,
    first_name: typeof row.firstName === 'string' ? row.firstName : null,
    last_name: typeof row.lastName === 'string' ? row.lastName : null,
    role: row.role === 'superadmin' ? 'superadmin' : 'student',
    class_id: typeof row.classId === 'string' ? row.classId : null,
    onboarding_complete: typeof row.onboardingComplete === 'boolean' ? row.onboardingComplete : null,
    curriculum_profile: row.curriculumProfile ?? null,
    arena_stats: row.arenaStats ?? null,
    user_state: row,
    updated_at: nowIso(),
  };
}

function mapEconomy(row) {
  const econ = row.economy ?? {};
  return {
    user_id: String(row.id),
    gold: typeof econ.gold === 'number' ? econ.gold : 0,
    global_xp: typeof econ.global_xp === 'number' ? econ.global_xp : 0,
    streak: typeof econ.streak === 'number' ? econ.streak : 0,
    energy: typeof econ.energy === 'number' ? econ.energy : 0,
    ranked_energy_streak: typeof econ.rankedEnergyStreak === 'number' ? econ.rankedEnergyStreak : 0,
    updated_at: nowIso(),
  };
}

async function migratePrograms() {
  const [publicPrograms, draftPrograms] = await Promise.all([
    readCollection('public_programs'),
    readCollection('draft_programs'),
  ]);
  summary.programs.public = publicPrograms.length;
  summary.programs.draft = draftPrograms.length;
  await upsertRows('public_programs', publicPrograms.map(mapProgramRow));
  await upsertRows('draft_programs', draftPrograms.map(mapProgramRow));
  console.log(`${DRY_RUN ? 'Dry run for' : 'Migrated'} programs: public=${publicPrograms.length}, draft=${draftPrograms.length}`);
}

async function migrateLogicGames() {
  const [pubNodes, draftNodes, pubQuestions, draftQuestions] = await Promise.all([
    readCollection('logic_game_nodes_public'),
    readCollection('logic_game_nodes_draft'),
    readCollection('logic_game_questions_public'),
    readCollection('logic_game_questions_draft'),
  ]);
  await upsertRows('logic_game_nodes_public', pubNodes.map(mapLogicNode));
  await upsertRows('logic_game_nodes_draft', draftNodes.map(mapLogicNode));
  const pubRows = pubQuestions.flatMap((row) => mapLogicQuestions(row.id, row));
  const draftRows = draftQuestions.flatMap((row) => mapLogicQuestions(row.id, row));
  summary.logicGames.publicNodes = pubNodes.length;
  summary.logicGames.draftNodes = draftNodes.length;
  summary.logicGames.publicQuestions = pubRows.length;
  summary.logicGames.draftQuestions = draftRows.length;
  if (pubRows.length) {
    if (!DRY_RUN) {
      const { error } = await supabase.from('logic_game_questions_public').upsert(pubRows, { onConflict: 'node_id,question_id' });
      if (error) throw error;
    }
  }
  if (draftRows.length) {
    if (!DRY_RUN) {
      const { error } = await supabase.from('logic_game_questions_draft').upsert(draftRows, { onConflict: 'node_id,question_id' });
      if (error) throw error;
    }
  }
  console.log(`${DRY_RUN ? 'Dry run for' : 'Migrated'} logic games: publicNodes=${pubNodes.length}, draftNodes=${draftNodes.length}, publicQuestions=${pubRows.length}, draftQuestions=${draftRows.length}`);
}

async function migrateUsers() {
  const users = await readCollection('users');
  summary.users.profiles = users.length;
  summary.users.economies = users.length;
  await upsertRows('profiles', users.map(mapProfile));
  await upsertRows('user_economy', users.map(mapEconomy), 'user_id');
  const progressRows = [];
  for (const user of users) {
    const pp = user.progress && typeof user.progress === 'object' ? user.progress : {};
    for (const [curriculumId, curriculum] of Object.entries(pp)) {
      if (!curriculum || typeof curriculum !== 'object') continue;
      for (const [chapterId, chapter] of Object.entries(curriculum)) {
        if (!chapter || typeof chapter !== 'object') continue;
        for (const [objectiveId, obj] of Object.entries(chapter)) {
          if (!obj || typeof obj !== 'object') continue;
          progressRows.push({
            user_id: String(user.id),
            program_id: `${curriculumId}:${chapterId}`,
            question_id: objectiveId,
            solved: Boolean(obj.mastered),
            last_answered_at: typeof obj.completedAt === 'string' ? obj.completedAt : null,
          });
        }
      }
    }
  }
  summary.users.skippedCurriculumProgressRows = progressRows.length;
  console.log(`${DRY_RUN ? 'Dry run for' : 'Migrated'} users: ${users.length}`);
  console.log(`Skipped curriculum progress row import into question_progress: ${progressRows.length} derived rows are not 1:1 with program question progress schema.`);
}

async function migrateAssets() {
  const [files] = await firebaseStorage.getFiles({ prefix: 'programAssets/' });
  summary.assets.discovered = files.filter((file) => !!file.name && !file.name.endsWith('/')).length;
  let copied = 0;
  for (const file of files) {
    if (!file.name || file.name.endsWith('/')) continue;
    const destPath = file.name.replace(/^programAssets\//, '');
    if (!DRY_RUN) {
      const [buffer] = await file.download();
      const { error } = await supabase.storage.from('program-assets').upload(destPath, buffer, {
        upsert: true,
        contentType: file.metadata?.contentType || 'application/octet-stream',
      });
      if (error) throw error;
    }
    copied += 1;
  }
  summary.assets.copied = copied;
  console.log(`${DRY_RUN ? 'Dry run for' : 'Migrated'} storage assets: ${copied}`);
}

async function main() {
  console.log(`Starting Firebase -> Supabase migration${DRY_RUN ? ' (dry run)' : ''}...`);
  await migratePrograms();
  await migrateLogicGames();
  await migrateUsers();
  await migrateAssets();
  console.log('Migration summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`${DRY_RUN ? 'Dry run complete.' : 'Migration complete.'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
