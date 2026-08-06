import { requireSupabase } from '@/lib/supabase';
import type {
  LogicGameNode,
  LogicGameQuestion,
  LogicGameQuestionsDoc,
  LogicGameServedQuestion,
  LogicGameSubmitResult,
  LogicGamesProgressDoc,
} from '@/types/logicGames';

const NODES_PUBLIC_COL = 'logic_game_nodes_public';
const QUESTIONS_PUBLIC_COL = 'logic_game_questions_public';

function mapNodeRow(row: Record<string, unknown>): LogicGameNode | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const iq = typeof row.iq === 'number' ? row.iq : NaN;
  const order = typeof row.sort_order === 'number' ? row.sort_order : typeof row.order === 'number' ? row.order : NaN;
  // seed_difficulty is the bucket's real field; fall back to the legacy level IQ
  // for rows written before the Elo migration.
  const seed = typeof row.seed_difficulty === 'number' ? row.seed_difficulty : iq;
  if (!id || !Number.isFinite(order)) return null;
  return {
    id,
    iq: Number.isFinite(iq) ? iq : undefined,
    seedDifficulty: Number.isFinite(seed) ? seed : 100,
    order,
    label: typeof row.label === 'string' ? row.label : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : typeof row.publishedAt === 'string' ? row.publishedAt : undefined,
  };
}

function mapQuestionRow(row: Record<string, unknown>) {
  return {
    id: typeof row.question_id === 'string' ? row.question_id : '',
    promptBlocks: Array.isArray(row.prompt_blocks) ? row.prompt_blocks as any : undefined,
    promptRawText: typeof row.prompt_raw_text === 'string' ? row.prompt_raw_text : undefined,
    promptLatex: typeof row.prompt_latex === 'string' ? row.prompt_latex : undefined,
    interaction: row.interaction as any,
    timeLimitSec: typeof row.time_limit_sec === 'number' ? row.time_limit_sec : 0,
    iqDeltaCorrect: typeof row.iq_delta_correct === 'number' ? row.iq_delta_correct : 0,
    iqDeltaWrong: typeof row.iq_delta_wrong === 'number' ? row.iq_delta_wrong : 0,
  };
}

function mapQuestionsRows(nodeId: string, rows: Record<string, unknown>[]): LogicGameQuestionsDoc {
  const sorted = [...rows].sort((a, b) => {
    const aa = typeof a.sort_order === 'number' ? a.sort_order : 0;
    const bb = typeof b.sort_order === 'number' ? b.sort_order : 0;
    return aa - bb;
  });
  return {
    nodeId,
    questions: sorted.map((row) => mapQuestionRow(row)),
    updatedAt: typeof sorted[sorted.length - 1]?.updated_at === 'string' ? sorted[sorted.length - 1].updated_at as string : new Date().toISOString(),
    publishedAt: typeof sorted[sorted.length - 1]?.published_at === 'string' ? sorted[sorted.length - 1].published_at as string : undefined,
  };
}

async function listNodes(table: string): Promise<LogicGameNode[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from(table).select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => mapNodeRow(row))
    .filter((node): node is LogicGameNode => !!node);
}

async function upsertNode(table: string, node: LogicGameNode, publishedAt?: string): Promise<void> {
  const now = new Date().toISOString();
  const supabase = requireSupabase();
  const payload: Record<string, unknown> = {
    id: node.id,
    // `iq` is deliberately not written. The phase 3 cleanup drops that column, and
    // naming it here would make every bucket save fail with "column iq does not
    // exist". Pre-cleanup databases still satisfy its NOT NULL via its default.
    seed_difficulty: node.seedDifficulty,
    label: node.label,
    sort_order: node.order,
    updated_at: now,
  };
  if (publishedAt) payload.published_at = publishedAt;
  const { error } = await supabase.from(table as any).upsert(payload as any);
  if (error) throw error;
}

async function getQuestions(table: string, nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from(table).select('*').eq('node_id', nodeId).order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  return mapQuestionsRows(nodeId, rows);
}

/** Reports real save progress: which phase, and how many rows are done. */
export type LogicGameSaveProgress = {
  phase: 'preparing' | 'saving' | 'removing' | 'done';
  completed: number;
  total: number;
};

async function replaceQuestions(
  table: string,
  nodeId: string,
  docData: Omit<LogicGameQuestionsDoc, 'nodeId'>,
  publishedAt?: string,
  onProgress?: (progress: LogicGameSaveProgress) => void,
): Promise<void> {
  const now = new Date().toISOString();
  const supabase = requireSupabase();

  const newQuestions = docData.questions;
  const newIds = new Set(newQuestions.map((q) => q.id));

  onProgress?.({ phase: 'preparing', completed: 0, total: newQuestions.length });

  // Step 1: Fetch existing question IDs for this node (lightweight query)
  const { data: existingRows, error: fetchError } = await supabase
    .from(table as any)
    .select('question_id')
    .eq('node_id', nodeId);
  if (fetchError) throw fetchError;

  const existingIds = new Set(((existingRows ?? []) as { question_id: string }[]).map((r) => r.question_id));
  const idsToDelete = [...existingIds].filter((id) => !newIds.has(id));

  // Step 2: Build rows to upsert
  const rows = newQuestions.map((q, idx) => ({
    node_id: nodeId,
    question_id: q.id,
    prompt_blocks: q.promptBlocks ?? null,
    prompt_raw_text: q.promptRawText ?? null,
    prompt_latex: q.promptLatex ?? null,
    interaction: q.interaction,
    time_limit_sec: q.timeLimitSec,
    iq_delta_correct: q.iqDeltaCorrect,
    iq_delta_wrong: q.iqDeltaWrong,
    sort_order: idx,
    updated_at: now,
  }));

  // Step 3: Upsert one by one (chunk size 1) to absolutely avoid payload size limits with heavy images
  const CHUNK_SIZE = 1;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    // One request per question, so the count reported here is the true state of
    // the save rather than an estimate.
    onProgress?.({ phase: 'saving', completed: i, total: rows.length });

    const { error: upsertError } = await supabase
      .from(table as any)
      .upsert(chunk as any, { onConflict: 'node_id,question_id' });
    if (upsertError) {
      console.error("[replaceQuestions] Upsert error details:", upsertError, chunk);
      throw new Error(`Supabase Upsert failed: ${upsertError.message || JSON.stringify(upsertError)}`);
    }
  }

  onProgress?.({ phase: 'saving', completed: rows.length, total: rows.length });

  // Step 4: Only now delete rows that were explicitly removed (selective, not blanket)
  if (idsToDelete.length > 0) {
    onProgress?.({ phase: 'removing', completed: rows.length, total: rows.length });
    const { error: deleteError } = await supabase
      .from(table as any)
      .delete()
      .eq('node_id', nodeId)
      .in('question_id', idsToDelete);
    if (deleteError) throw deleteError;
  }
}

export async function listLogicGameNodes(): Promise<LogicGameNode[]> {
  return listNodes(NODES_PUBLIC_COL);
}

export async function upsertLogicGameNode(node: LogicGameNode): Promise<void> {
  await upsertNode(NODES_PUBLIC_COL, node, new Date().toISOString());
}

export async function deleteLogicGameNode(nodeId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error: qError } = await supabase.from(QUESTIONS_PUBLIC_COL as any).delete().eq('node_id', nodeId);
  if (qError) throw qError;
  const { error } = await supabase.from(NODES_PUBLIC_COL as any).delete().eq('id', nodeId);
  if (error) throw error;
}

export async function getLogicGamesProgress(uid: string): Promise<LogicGamesProgressDoc | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('logic_game_progress').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: 'global',
    iq: typeof data.iq === 'number' ? data.iq : 80,
    peakIq: typeof data.peak_iq === 'number' ? data.peak_iq : (typeof data.iq === 'number' ? data.iq : 80),
    floorIq: typeof data.floor_iq === 'number' ? data.floor_iq : 80,
    nodeQueues: data.node_queues || {},
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : new Date().toISOString(),
  };
}

export async function ensureLogicGamesProgress(uid: string): Promise<LogicGamesProgressDoc> {
  const existing = await getLogicGamesProgress(uid);
  if (existing) return existing;
  const now = new Date().toISOString();
  const init: LogicGamesProgressDoc = { id: 'global', iq: 80, peakIq: 80, floorIq: 80, nodeQueues: {}, updatedAt: now };
  const supabase = requireSupabase();
  // node_queues is deliberately not written: the column does not exist on
  // logic_game_progress, and sending it made PostgREST reject the whole insert
  // with 400, so no progress row was ever created for a new player. The read
  // above already tolerates the column being absent.
  const { error } = await supabase.from('logic_game_progress').upsert({ user_id: uid, iq: 80, floor_iq: 80, updated_at: now });
  if (error) throw error;
  return init;
}

export async function setLogicGamesIq(uid: string, nextIq: number, nextFloorIq: number): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('logic_game_progress').upsert({
    user_id: uid,
    iq: nextIq,
    floor_iq: nextFloorIq,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getLogicGameQuestions(nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  return getQuestions(QUESTIONS_PUBLIC_COL, nodeId);
}

/**
 * Question ids only, in play order. `prompt_blocks` can hold inline image data, so
 * selecting whole rows makes opening a level scale with the level's total image
 * weight. The player only needs the id list up front — bodies are fetched a few at
 * a time by the functions below, which keeps open time flat regardless of size.
 */
export async function listLogicGameQuestionIds(nodeId: string): Promise<string[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(QUESTIONS_PUBLIC_COL)
    .select('question_id, sort_order')
    .eq('node_id', nodeId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => (typeof row.question_id === 'string' ? row.question_id : ''))
    .filter((id): id is string => !!id);
}

export async function getLogicGameQuestionsByIds(nodeId: string, questionIds: string[]): Promise<LogicGameQuestion[]> {
  if (questionIds.length === 0) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(QUESTIONS_PUBLIC_COL)
    .select('*')
    .eq('node_id', nodeId)
    .in('question_id', questionIds);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => mapQuestionRow(row));
}

export async function getLogicGameQuestionById(nodeId: string, questionId: string): Promise<LogicGameQuestion | null> {
  const rows = await getLogicGameQuestionsByIds(nodeId, [questionId]);
  return rows[0] ?? null;
}

// ─── Elo play loop ──────────────────────────────────────────────────────────
// Both of these run server-side. The client never decides what it scored, and
// never receives a question's answer key.

/**
 * Asks the server for a question matched to the player's rating that they have
 * never been served before. Returns null once they have answered everything.
 */
export async function fetchNextLogicGameQuestion(mode: 'iq' | 'chill' = 'iq'): Promise<LogicGameServedQuestion | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('logic_game_next_question', { p_mode: mode });
  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  if (!row || row.exhausted === true) return null;
  return {
    nodeId: String(row.nodeId ?? ''),
    questionId: String(row.questionId ?? ''),
    promptBlocks: Array.isArray(row.promptBlocks) ? row.promptBlocks as any : undefined,
    promptRawText: typeof row.promptRawText === 'string' ? row.promptRawText : undefined,
    promptLatex: typeof row.promptLatex === 'string' ? row.promptLatex : undefined,
    timeLimitSec: typeof row.timeLimitSec === 'number' ? row.timeLimitSec : 0,
    interaction: row.interaction as any,
  };
}

export type LogicGameAnswerPayload =
  | { kind: 'mcq'; choiceIndex: number }
  | { kind: 'numeric'; valueText: string }
  | { kind: 'text'; valueText: string };

/**
 * Submits what the student chose. The server grades it, moves both the player's
 * and the question's rating, and records the answer so it can never be served again.
 */
export async function submitLogicGameAnswer(input: {
  nodeId: string;
  questionId: string;
  answer: LogicGameAnswerPayload;
  timeMs?: number;
  mode?: 'iq' | 'chill';
}): Promise<LogicGameSubmitResult> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('logic_game_submit_answer', {
    p_node_id: input.nodeId,
    p_question_id: input.questionId,
    p_answer: input.answer,
    p_time_ms: typeof input.timeMs === 'number' ? Math.round(input.timeMs) : null,
    p_mode: input.mode ?? 'iq',
  });
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : Number(v ?? fallback) || fallback);
  return {
    alreadyAnswered: row.alreadyAnswered === true,
    correct: row.correct === true,
    mode: row.mode === 'chill' ? 'chill' : 'iq',
    iqBefore: num(row.iqBefore, 80),
    iqAfter: num(row.iqAfter, 80),
    delta: num(row.delta, 0),
    peakIq: row.peakIq == null ? undefined : num(row.peakIq, 80),
  };
}

export async function upsertLogicGameQuestions(
  nodeId: string,
  docData: Omit<LogicGameQuestionsDoc, 'nodeId'>,
  onProgress?: (progress: LogicGameSaveProgress) => void,
): Promise<void> {
  await replaceQuestions(QUESTIONS_PUBLIC_COL, nodeId, docData, new Date().toISOString(), onProgress);
  onProgress?.({ phase: 'done', completed: docData.questions.length, total: docData.questions.length });
}
