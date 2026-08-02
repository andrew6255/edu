import type { TutorAnswerPackage } from './types';
import { logger } from '../../lib/logger';

type CacheRow = {
  program_id: string;
  question_id: string;
  question_hash: string;
  answer_package: TutorAnswerPackage;
};

const memoryCache = new Map<string, CacheRow>();

function cacheKey(programId: string | undefined, questionId: string): string {
  return `${programId || 'unscoped'}::${questionId}`;
}

function config(): { url: string; key: string } | null {
  const url = (process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'] ?? '').replace(/\/+$/, '');
  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
  return url && key ? { url, key } : null;
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export async function readCachedAnswer(programId: string | undefined, questionId: string, questionHash: string): Promise<TutorAnswerPackage | null> {
  const key = cacheKey(programId, questionId);
  const local = memoryCache.get(key);
  if (local?.question_hash === questionHash) return local.answer_package;

  const db = config();
  if (!db || !programId) return null;
  try {
    const query = new URL(`${db.url}/rest/v1/question_ai_answers`);
    query.searchParams.set('select', 'program_id,question_id,question_hash,answer_package');
    query.searchParams.set('program_id', `eq.${programId}`);
    query.searchParams.set('question_id', `eq.${questionId}`);
    query.searchParams.set('limit', '1');
    const response = await fetch(query, { headers: headers(db.key) });
    if (!response.ok) throw new Error(`Supabase returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const rows = await response.json() as CacheRow[];
    const row = rows[0];
    if (!row || row.question_hash !== questionHash || !row.answer_package?.modelAnswer) return null;
    memoryCache.set(key, row);
    return row.answer_package;
  } catch (error) {
    logger.warn({ err: error }, '[ai-tutor] shared answer cache read failed; using process cache');
    return null;
  }
}

export async function writeCachedAnswer(programId: string | undefined, questionId: string, questionHash: string, answerPackage: TutorAnswerPackage): Promise<void> {
  const key = cacheKey(programId, questionId);
  const row: CacheRow = {
    program_id: programId || 'unscoped',
    question_id: questionId,
    question_hash: questionHash,
    answer_package: answerPackage,
  };
  memoryCache.set(key, row);

  const db = config();
  if (!db || !programId) return;
  try {
    const response = await fetch(`${db.url}/rest/v1/question_ai_answers?on_conflict=program_id,question_id`, {
      method: 'POST',
      headers: { ...headers(db.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`Supabase returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  } catch (error) {
    logger.warn({ err: error }, '[ai-tutor] shared answer cache write failed; answer remains in process cache');
  }
}

