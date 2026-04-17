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
  deletedAt?: string;
  updatedAt?: string;
};

function fromSupabaseRow(row: Record<string, unknown>): ProgramAdminRecord {
  return {
    id: String(row.id ?? ''),
    title: typeof row.title === 'string' ? row.title : undefined,
    subject: typeof row.subject === 'string' ? row.subject : undefined,
    grade_band: typeof row.grade_band === 'string' ? row.grade_band : undefined,
    coverEmoji: typeof row.cover_emoji === 'string' ? row.cover_emoji : undefined,
    builderSpec: row.builder_spec,
    toc: row.toc,
    annotations: row.annotations,
    programMeta: row.program_meta,
    questionBanksByChapter: row.question_banks_by_chapter,
    rankedTotalQuestionCount: typeof row.ranked_total_question_count === 'number' ? row.ranked_total_question_count : undefined,
    deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

function toSupabaseRow(id: string, payload: Record<string, unknown>, status: 'draft' | 'published'): Record<string, unknown> {
  return {
    id,
    title: payload.title,
    subject: payload.subject,
    grade_band: payload.grade_band,
    cover_emoji: payload.coverEmoji,
    builder_spec: payload.builderSpec,
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

export async function saveDraftProgramAdmin(programId: string, payload: Record<string, unknown>): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('draft_programs').upsert(toSupabaseRow(programId, payload, 'draft'));
  if (error) throw error;
}

export async function publishProgramAdmin(programId: string, payload: Record<string, unknown>, draftProgramId?: string | null): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('public_programs').upsert(toSupabaseRow(programId, payload, 'published'));
  if (error) throw error;
  if (draftProgramId) {
    const { error: deleteError } = await supabase.from('draft_programs').delete().eq('id', draftProgramId);
    if (deleteError) throw deleteError;
  }
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
