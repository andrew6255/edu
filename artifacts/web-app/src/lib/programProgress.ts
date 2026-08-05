import { getUserDoc, setUserDoc, updateUserDoc, listUserDocs } from '@/lib/supabaseDocStore';

export type ProgramProgressDoc = {
  programId: string;
  completedUnitIds: string[];
  solvedQuestionIds?: string[];
  rankedTrophies?: number;
  rankedSolvedQuestionIds?: string[];
  rankedIncorrectQuestionIds?: string[];
  claimedRewardIds?: string[];
  updatedAt: string;
};

export async function getProgramProgress(uid: string, programId: string): Promise<ProgramProgressDoc | null> {
  const raw = await getUserDoc(uid, 'program_progress', programId);
  if (!raw) return null;
  const data = raw as Partial<ProgramProgressDoc>;
  return {
    programId,
    completedUnitIds: Array.isArray(data.completedUnitIds) ? (data.completedUnitIds as string[]) : [],
    solvedQuestionIds: Array.isArray((data as any).solvedQuestionIds) ? ((data as any).solvedQuestionIds as string[]) : [],
    rankedTrophies: typeof (data as any).rankedTrophies === 'number' ? ((data as any).rankedTrophies as number) : 0,
    rankedSolvedQuestionIds: Array.isArray((data as any).rankedSolvedQuestionIds) ? ((data as any).rankedSolvedQuestionIds as string[]) : [],
    rankedIncorrectQuestionIds: Array.isArray((data as any).rankedIncorrectQuestionIds) ? ((data as any).rankedIncorrectQuestionIds as string[]) : [],
    claimedRewardIds: Array.isArray((data as any).claimedRewardIds) ? ((data as any).claimedRewardIds as string[]) : [],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function listProgramProgress(uid: string): Promise<Record<string, ProgramProgressDoc>> {
  const rows = await listUserDocs(uid, 'program_progress');
  const out: Record<string, ProgramProgressDoc> = {};
  for (const row of rows) {
    const docId = row.id;
    const data = row.data as Partial<ProgramProgressDoc>;
    out[docId] = {
      programId: docId,
      completedUnitIds: Array.isArray(data.completedUnitIds) ? (data.completedUnitIds as string[]) : [],
      solvedQuestionIds: Array.isArray((data as any).solvedQuestionIds) ? ((data as any).solvedQuestionIds as string[]) : [],
      rankedTrophies: typeof (data as any).rankedTrophies === 'number' ? ((data as any).rankedTrophies as number) : 0,
      rankedSolvedQuestionIds: Array.isArray((data as any).rankedSolvedQuestionIds) ? ((data as any).rankedSolvedQuestionIds as string[]) : [],
      rankedIncorrectQuestionIds: Array.isArray((data as any).rankedIncorrectQuestionIds) ? ((data as any).rankedIncorrectQuestionIds as string[]) : [],
      claimedRewardIds: Array.isArray((data as any).claimedRewardIds) ? ((data as any).claimedRewardIds as string[]) : [],
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    };
  }
  return out;
}

export async function toggleQuestionSolved(uid: string, programId: string, questionId: string): Promise<boolean> {
  const existing = await getUserDoc(uid, 'program_progress', programId);
  const now = new Date().toISOString();

  if (!existing) {
    await setUserDoc(uid, 'program_progress', programId, {
      programId,
      completedUnitIds: [],
      solvedQuestionIds: [questionId],
      updatedAt: now,
    } as any);
    return true;
  }

  const current = Array.isArray((existing as any).solvedQuestionIds) ? ((existing as any).solvedQuestionIds as string[]) : [];
  let next;
  let isSolved = false;
  if (current.includes(questionId)) {
    next = current.filter(id => id !== questionId);
  } else {
    next = Array.from(new Set([...current, questionId]));
    isSolved = true;
  }

  await updateUserDoc(uid, 'program_progress', programId, { solvedQuestionIds: next, updatedAt: now });
  return isSolved;
}

export async function applyRankedAnswer(
  uid: string,
  programId: string,
  questionId: string,
  answer: import('@/lib/economyApiService').ProgramAnswer
): Promise<import('@/lib/economyApiService').RankedProgramAnswerResult> {
  void uid;
  const { recordRankedProgramAnswer } = await import('@/lib/economyApiService');
  return recordRankedProgramAnswer(programId, questionId, answer);
}

export async function toggleUnitComplete(uid: string, programId: string, unitId: string): Promise<void> {
  const existing = await getUserDoc(uid, 'program_progress', programId);
  const now = new Date().toISOString();

  if (!existing) {
    await setUserDoc(uid, 'program_progress', programId, {
      programId,
      completedUnitIds: [unitId],
      updatedAt: now,
    } as any);
    return;
  }

  const current = Array.isArray((existing as any).completedUnitIds) ? ((existing as any).completedUnitIds as string[]) : [];
  const next = current.includes(unitId) ? current.filter((x) => x !== unitId) : Array.from(new Set([...current, unitId]));
  await updateUserDoc(uid, 'program_progress', programId, { completedUnitIds: next, updatedAt: now });
}
