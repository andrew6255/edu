import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';
import type { FreeformGradingDetails } from '@/lib/freeformGradingService';
import type { InteractionGradeResult } from '@/lib/interactionGrader';

const FREEFORM_HISTORY_COLLECTION = 'program_freeform_history';
const FREEFORM_ANALYTICS_COLLECTION = 'program_freeform_analytics';

export type FreeformSubmissionRecord = {
  id: string;
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

export type FreeformProgramAnalyticsDoc = {
  programId: string;
  totalSubmissions: number;
  gradedCount: number;
  pendingReviewCount: number;
  correctCount: number;
  lastSubmissionAt: string;
  updatedAt: string;
};

function makeSubmissionId(): string {
  return `freeform_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordFreeformSubmission(args: {
  uid: string;
  programId: string | null;
  questionId: string;
  questionText: string;
  answerText: string;
  gradingMode: 'ai' | 'manual';
  stepValues?: Record<string, string> | null;
  result: InteractionGradeResult & { provider?: string; details?: FreeformGradingDetails | null };
}): Promise<void> {
  const now = new Date().toISOString();
  const record: FreeformSubmissionRecord = {
    id: makeSubmissionId(),
    programId: args.programId,
    questionId: args.questionId,
    questionText: args.questionText,
    answerText: args.answerText,
    gradingMode: args.gradingMode,
    status: args.result.status === 'pending_review' ? 'pending_review' : 'graded',
    correct: args.result.correct === true,
    provider: args.result.provider,
    feedbackText: args.result.feedbackText ?? null,
    details: args.result.details ?? null,
    stepValues: args.stepValues ?? null,
    createdAt: now,
  };

  await setUserDoc(args.uid, FREEFORM_HISTORY_COLLECTION, record.id, record as unknown as Record<string, unknown>);

  if (!args.programId) return;

  const analyticsDocId = args.programId;
  const existing = await getUserDoc(args.uid, FREEFORM_ANALYTICS_COLLECTION, analyticsDocId);
  if (!existing) {
    const created: FreeformProgramAnalyticsDoc = {
      programId: args.programId,
      totalSubmissions: 1,
      gradedCount: record.status === 'graded' ? 1 : 0,
      pendingReviewCount: record.status === 'pending_review' ? 1 : 0,
      correctCount: record.correct ? 1 : 0,
      lastSubmissionAt: now,
      updatedAt: now,
    };
    await setUserDoc(args.uid, FREEFORM_ANALYTICS_COLLECTION, analyticsDocId, created as unknown as Record<string, unknown>);
    return;
  }

  const data = existing as Partial<FreeformProgramAnalyticsDoc>;
  await updateUserDoc(args.uid, FREEFORM_ANALYTICS_COLLECTION, analyticsDocId, {
    totalSubmissions: (typeof data.totalSubmissions === 'number' ? data.totalSubmissions : 0) + 1,
    gradedCount: (typeof data.gradedCount === 'number' ? data.gradedCount : 0) + (record.status === 'graded' ? 1 : 0),
    pendingReviewCount: (typeof data.pendingReviewCount === 'number' ? data.pendingReviewCount : 0) + (record.status === 'pending_review' ? 1 : 0),
    correctCount: (typeof data.correctCount === 'number' ? data.correctCount : 0) + (record.correct ? 1 : 0),
    lastSubmissionAt: now,
    updatedAt: now,
  });
}
