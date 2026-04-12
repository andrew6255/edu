import { requireSupabase } from '@/lib/supabase';
import type { LogicGameNode, LogicGameQuestionsDoc, LogicGamesProgressDoc } from '@/types/logicGames';

const NODES_PUBLIC_COL = 'logic_game_nodes_public';
const NODES_DRAFT_COL = 'logic_game_nodes_draft';
const QUESTIONS_PUBLIC_COL = 'logic_game_questions_public';
const QUESTIONS_DRAFT_COL = 'logic_game_questions_draft';

function mapNodeRow(row: Record<string, unknown>): LogicGameNode | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const iq = typeof row.iq === 'number' ? row.iq : NaN;
  const order = typeof row.sort_order === 'number' ? row.sort_order : typeof row.order === 'number' ? row.order : NaN;
  if (!id || !Number.isFinite(iq) || !Number.isFinite(order)) return null;
  return {
    id,
    iq,
    order,
    label: typeof row.label === 'string' ? row.label : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : typeof row.publishedAt === 'string' ? row.publishedAt : undefined,
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
    questions: sorted.map((row) => ({
      id: typeof row.question_id === 'string' ? row.question_id : '',
      promptBlocks: Array.isArray(row.prompt_blocks) ? row.prompt_blocks as any : undefined,
      promptRawText: typeof row.prompt_raw_text === 'string' ? row.prompt_raw_text : undefined,
      promptLatex: typeof row.prompt_latex === 'string' ? row.prompt_latex : undefined,
      interaction: row.interaction as any,
      timeLimitSec: typeof row.time_limit_sec === 'number' ? row.time_limit_sec : 0,
      iqDeltaCorrect: typeof row.iq_delta_correct === 'number' ? row.iq_delta_correct : 0,
      iqDeltaWrong: typeof row.iq_delta_wrong === 'number' ? row.iq_delta_wrong : 0,
    })),
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
    iq: node.iq,
    label: node.label,
    sort_order: node.order,
    updated_at: now,
  };
  if (publishedAt) payload.published_at = publishedAt;
  const { error } = await supabase.from(table).upsert(payload);
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

async function replaceQuestions(table: string, nodeId: string, docData: Omit<LogicGameQuestionsDoc, 'nodeId'>, publishedAt?: string): Promise<void> {
  const now = new Date().toISOString();
  const supabase = requireSupabase();
  const { error: deleteError } = await supabase.from(table).delete().eq('node_id', nodeId);
  if (deleteError) throw deleteError;
  if (docData.questions.length === 0) return;
  const rows = docData.questions.map((q, idx) => ({
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
    ...(publishedAt ? { published_at: publishedAt } : {}),
  }));
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw error;
}

export async function listPublishedLogicGameNodes(): Promise<LogicGameNode[]> {
  return listNodes(NODES_PUBLIC_COL);
}

export async function upsertPublishedLogicGameNode(node: LogicGameNode): Promise<void> {
  await upsertNode(NODES_PUBLIC_COL, node);
}

export async function deletePublishedLogicGameNode(nodeId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error: qError } = await supabase.from(QUESTIONS_PUBLIC_COL).delete().eq('node_id', nodeId);
  if (qError) throw qError;
  const { error } = await supabase.from(NODES_PUBLIC_COL).delete().eq('id', nodeId);
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
    floorIq: typeof data.floor_iq === 'number' ? data.floor_iq : 80,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : new Date().toISOString(),
  };
}

export async function ensureLogicGamesProgress(uid: string): Promise<LogicGamesProgressDoc> {
  const existing = await getLogicGamesProgress(uid);
  if (existing) return existing;
  const now = new Date().toISOString();
  const init: LogicGamesProgressDoc = { id: 'global', iq: 80, floorIq: 80, updatedAt: now };
  const supabase = requireSupabase();
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

export async function listDraftLogicGameNodes(): Promise<LogicGameNode[]> {
  return listNodes(NODES_DRAFT_COL);
}

export async function upsertDraftLogicGameNode(node: LogicGameNode): Promise<void> {
  await upsertNode(NODES_DRAFT_COL, node);
}

export async function deleteDraftLogicGameNode(nodeId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error: qError } = await supabase.from(QUESTIONS_DRAFT_COL).delete().eq('node_id', nodeId);
  if (qError) throw qError;
  const { error } = await supabase.from(NODES_DRAFT_COL).delete().eq('id', nodeId);
  if (error) throw error;
}

export async function publishLogicGameNode(nodeId: string): Promise<void> {
  const nodes = await listDraftLogicGameNodes();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('Draft node not found');
  const now = new Date().toISOString();
  await upsertNode(NODES_PUBLIC_COL, node, now);
}

export async function getDraftLogicGameQuestions(nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  return getQuestions(QUESTIONS_DRAFT_COL, nodeId);
}

export async function getPublishedLogicGameQuestions(nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  return getQuestions(QUESTIONS_PUBLIC_COL, nodeId);
}

export async function upsertDraftLogicGameQuestions(nodeId: string, docData: Omit<LogicGameQuestionsDoc, 'nodeId'>): Promise<void> {
  await replaceQuestions(QUESTIONS_DRAFT_COL, nodeId, docData);
}

export async function publishLogicGameQuestions(nodeId: string): Promise<void> {
  const data = await getDraftLogicGameQuestions(nodeId);
  if (!data) throw new Error('Draft questions not found');
  const now = new Date().toISOString();
  await replaceQuestions(QUESTIONS_PUBLIC_COL, nodeId, data, now);
}

export async function upsertPublishedLogicGameQuestions(nodeId: string, docData: Omit<LogicGameQuestionsDoc, 'nodeId'>): Promise<void> {
  await replaceQuestions(QUESTIONS_PUBLIC_COL, nodeId, docData);
}
