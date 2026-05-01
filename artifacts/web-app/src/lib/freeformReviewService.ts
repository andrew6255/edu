import { requireSupabase } from '@/lib/supabase';
import type { FreeformGradingDetails } from '@/lib/freeformGradingService';

export type FreeformReviewRow = {
  id: string;
  userId: string;
  programId: string | null;
  questionId: string;
  questionText: string;
  answerText: string;
  gradingMode: 'ai' | 'manual';
  status: 'graded' | 'pending_review';
  correct: boolean;
  provider?: string;
  feedbackText?: string | null;
  details?: FreeformGradingDetails | null;
  stepValues?: Record<string, string> | null;
  createdAt: string;
};

export async function listFreeformReviewsForUsers(userIds: string[]): Promise<FreeformReviewRow[]> {
  const ids = Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
  if (ids.length === 0) return [];
  const { data, error } = await requireSupabase()
    .from('user_docs')
    .select('doc_id, user_id, data')
    .eq('collection', 'program_freeform_history')
    .in('user_id', ids)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const payload = (row.data ?? {}) as Record<string, unknown>;
    return {
      id: String(row.doc_id),
      userId: String(row.user_id),
      programId: typeof payload.programId === 'string' ? payload.programId : null,
      questionId: typeof payload.questionId === 'string' ? payload.questionId : '',
      questionText: typeof payload.questionText === 'string' ? payload.questionText : '',
      answerText: typeof payload.answerText === 'string' ? payload.answerText : '',
      gradingMode: payload.gradingMode === 'manual' ? 'manual' : 'ai',
      status: payload.status === 'pending_review' ? 'pending_review' : 'graded',
      correct: payload.correct === true,
      provider: typeof payload.provider === 'string' ? payload.provider : undefined,
      feedbackText: typeof payload.feedbackText === 'string' ? payload.feedbackText : null,
      details: payload.details && typeof payload.details === 'object' ? payload.details as FreeformGradingDetails : null,
      stepValues: payload.stepValues && typeof payload.stepValues === 'object' ? payload.stepValues as Record<string, string> : null,
      createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
    } satisfies FreeformReviewRow;
  });
}
