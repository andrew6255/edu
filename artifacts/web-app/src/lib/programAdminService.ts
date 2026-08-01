import { requireSupabase } from '@/lib/supabase';

export type ProgramAdminRecord = {
  id: string;
  title?: string;
  subject?: string;
  grade_band?: string;
  coverEmoji?: string;
  builderSpec?: unknown;
  toc?: unknown;
  annotations?: unknown;
  programMeta?: unknown;
  questionBanksByChapter?: unknown;
  rankedTotalQuestionCount?: number;
  adminWhiteboardData?: unknown;
  deletedAt?: string;
  updatedAt?: string;
  revision?: number;
  versionNumber?: number;
};

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function fromSupabaseRow(row: Record<string, unknown>): ProgramAdminRecord {
  const builderSpec = parseJsonField(row.builder_spec) as Record<string, unknown> | undefined;
  const adminWhiteboardData = builderSpec?._adminWhiteboardData;
  return {
    id: String(row.id ?? ''),
    title: typeof row.title === 'string' ? row.title : undefined,
    subject: typeof row.subject === 'string' ? row.subject : undefined,
    grade_band: typeof row.grade_band === 'string' ? row.grade_band : undefined,
    coverEmoji: typeof row.cover_emoji === 'string' ? row.cover_emoji : undefined,
    builderSpec,
    toc: parseJsonField(row.toc),
    annotations: parseJsonField(row.annotations),
    programMeta: parseJsonField(row.program_meta),
    questionBanksByChapter: parseJsonField(row.question_banks_by_chapter),
    adminWhiteboardData,
    rankedTotalQuestionCount: typeof row.ranked_total_question_count === 'number' ? row.ranked_total_question_count : undefined,
    deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    revision: typeof row.revision === 'number' ? row.revision : undefined,
    versionNumber: typeof row.version_number === 'number' ? row.version_number : undefined,
  };
}

function toSupabaseRow(id: string, payload: Record<string, unknown>, status: 'draft' | 'published'): Record<string, unknown> {
  const builder_spec = payload.builderSpec && typeof payload.builderSpec === 'object'
    ? { ...(payload.builderSpec as Record<string, unknown>), _adminWhiteboardData: payload.adminWhiteboardData }
    : { _adminWhiteboardData: payload.adminWhiteboardData };

  return {
    id,
    title: payload.title,
    subject: payload.subject,
    grade_band: payload.grade_band,
    cover_emoji: payload.coverEmoji,
    builder_spec,
    toc: payload.toc,
    annotations: payload.annotations,
    program_meta: payload.programMeta,
    question_banks_by_chapter: payload.questionBanksByChapter,
    ranked_total_question_count: payload.rankedTotalQuestionCount ?? 0,
    deleted_at: payload.deletedAt,
    updated_at: payload.updatedAt,
  };
}

export async function listProgramsAdmin(status: 'draft' | 'published'): Promise<ProgramAdminRecord[]> {
  const tableName = status === 'draft' ? 'draft_programs' : 'public_programs';
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(tableName)
    .select('id,title,subject,grade_band,cover_emoji,ranked_total_question_count,deleted_at,updated_at')
    .order('title', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((row: Record<string, unknown>) => fromSupabaseRow(row))
    .filter((row: ProgramAdminRecord) => !(typeof row.deletedAt === 'string' && row.deletedAt));
}

export async function listPublishedProgramsFull(): Promise<ProgramAdminRecord[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('public_programs')
    .select('*')
    .order('title', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((row: Record<string, unknown>) => fromSupabaseRow(row))
    .filter((row: ProgramAdminRecord) => !(typeof row.deletedAt === 'string' && row.deletedAt));
}

export async function getDraftProgramAdmin(programId: string): Promise<ProgramAdminRecord | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('draft_programs')
    .select('*')
    .eq('id', programId)
    .maybeSingle();
  if (error) throw error;
  return data ? fromSupabaseRow(data as Record<string, unknown>) : null;
}

export async function getPublishedProgramAdmin(programId: string): Promise<ProgramAdminRecord | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('public_programs')
    .select('*')
    .eq('id', programId)
    .maybeSingle();
  if (error) throw error;
  return data ? fromSupabaseRow(data as Record<string, unknown>) : null;
}

function isMissingTransactionalRpc(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist/i.test(error.message ?? ''));
}

export async function saveDraftProgramAdmin(programId: string, payload: Record<string, unknown>, options?: {
  expectedRevision?: number;
  organizerDecision?: Record<string, unknown> | null;
}): Promise<{ revision: number; updatedAt: string }> {
  const supabase = requireSupabase();
  const row = toSupabaseRow(programId, payload, 'draft');
  const rpcPayload = { ...row };
  delete rpcPayload.id;
  const { data, error } = await supabase.rpc('save_program_draft_revision', {
    p_program_id: programId,
    p_payload: rpcPayload,
    p_expected_revision: options?.expectedRevision ?? 0,
    p_organizer_decision: options?.organizerDecision ?? null,
  });
  if (!error) {
    const result = Array.isArray(data) ? data[0] : data;
    return { revision: Number(result?.revision ?? 0), updatedAt: String(result?.updated_at ?? new Date().toISOString()) };
  }
  if (!isMissingTransactionalRpc(error)) throw error;
  const fallback = await supabase.from('draft_programs').upsert(row);
  if (fallback.error) throw fallback.error;
  return { revision: options?.expectedRevision ?? 0, updatedAt: String(payload.updatedAt ?? new Date().toISOString()) };
}

export async function publishProgramAdmin(programId: string, payload: Record<string, unknown>, draftProgramId?: string | null, expectedRevision?: number): Promise<void> {
  const supabase = requireSupabase();
  if (draftProgramId && expectedRevision != null) {
    const transaction = await supabase.rpc('publish_program_draft_revision', { p_program_id: draftProgramId, p_expected_revision: expectedRevision });
    if (!transaction.error) return;
    if (!isMissingTransactionalRpc(transaction.error)) throw transaction.error;
  }
  const { error } = await supabase.from('public_programs').upsert(toSupabaseRow(programId, payload, 'published'));
  if (error) throw error;
  if (draftProgramId) {
    const { error: deleteError } = await supabase.from('draft_programs').delete().eq('id', draftProgramId);
    if (deleteError) throw deleteError;
  }
}

export async function listProgramVersionsAdmin(programId: string): Promise<Array<{ versionNumber: number; publishedAt: string; publishedBy: string }>> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('program_versions').select('version_number,published_at,published_by').eq('program_id', programId).order('version_number', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => ({ versionNumber: Number(row.version_number), publishedAt: String(row.published_at), publishedBy: String(row.published_by) }));
}

export async function rollbackProgramVersionToDraftAdmin(programId: string, versionNumber: number): Promise<{ revision: number; updatedAt: string }> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('rollback_program_version_to_draft', { p_program_id: programId, p_version_number: versionNumber });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return { revision: Number(result?.revision ?? 1), updatedAt: String(result?.updated_at ?? new Date().toISOString()) };
}

export async function deleteDraftProgramAdmin(programId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('draft_programs').delete().eq('id', programId);
  if (error) throw error;
}

export async function savePublishedProgramAdmin(programId: string, payload: Record<string, unknown>): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('public_programs').upsert(toSupabaseRow(programId, payload, 'published'));
  if (error) throw error;
}

export async function softDeletePublishedProgramAdmin(programId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('public_programs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', programId);
  if (error) throw error;
}
