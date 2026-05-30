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

export async function claimRoadmapReward(uid: string, programId: string, rewardId: string): Promise<{ claimed: boolean }> {
  const existing = await getUserDoc(uid, 'program_progress', programId);
  const now = new Date().toISOString();

  if (!existing) {
    await setUserDoc(uid, 'program_progress', programId, {
      programId,
      completedUnitIds: [],
      solvedQuestionIds: [],
      rankedTrophies: 0,
      rankedSolvedQuestionIds: [],
      rankedIncorrectQuestionIds: [],
      claimedRewardIds: [rewardId],
      updatedAt: now,
    } as any);
    return { claimed: true };
  }

  const current = Array.isArray((existing as any).claimedRewardIds) ? ((existing as any).claimedRewardIds as string[]) : [];
  if (current.includes(rewardId)) {
    await updateUserDoc(uid, 'program_progress', programId, { updatedAt: now });
    return { claimed: false };
  }

  await updateUserDoc(uid, 'program_progress', programId, { claimedRewardIds: Array.from(new Set([...current, rewardId])), updatedAt: now });
  return { claimed: true };
}

export async function markQuestionSolved(uid: string, programId: string, questionId: string): Promise<void> {
  const existing = await getUserDoc(uid, 'program_progress', programId);
  const now = new Date().toISOString();

  if (!existing) {
    await setUserDoc(uid, 'program_progress', programId, {
      programId,
      completedUnitIds: [],
      solvedQuestionIds: [questionId],
      updatedAt: now,
    } as any);
    return;
  }

  const current = Array.isArray((existing as any).solvedQuestionIds) ? ((existing as any).solvedQuestionIds as string[]) : [];
  if (current.includes(questionId)) {
    await updateUserDoc(uid, 'program_progress', programId, { updatedAt: now });
    return;
  }
  await updateUserDoc(uid, 'program_progress', programId, { solvedQuestionIds: Array.from(new Set([...current, questionId])), updatedAt: now });
}

export async function applyRankedAnswer(
  uid: string,
  programId: string,
  questionId: string,
  correct: boolean
): Promise<{ trophies: number; correctIds: string[]; incorrectIds: string[] }> {
  const existing = await getUserDoc(uid, 'program_progress', programId);
  const now = new Date().toISOString();

  const trophyMagnitude = 14 + Math.floor(Math.random() * 3);
  const delta = correct ? trophyMagnitude : -trophyMagnitude;

  if (!existing) {
    const trophies = Math.max(0, delta);
    const correctIds = correct ? [questionId] : [];
    const incorrectIds = correct ? [] : [questionId];
    await setUserDoc(uid, 'program_progress', programId, {
      programId,
      completedUnitIds: [],
      solvedQuestionIds: [],
      rankedTrophies: trophies,
      rankedSolvedQuestionIds: correctIds,
      rankedIncorrectQuestionIds: incorrectIds,
      updatedAt: now,
    } as any);
    return { trophies, correctIds, incorrectIds };
  }

  const data = existing as any;
  const currentTrophies = typeof data.rankedTrophies === 'number' ? (data.rankedTrophies as number) : 0;
  const currentSolved = Array.isArray(data.rankedSolvedQuestionIds) ? (data.rankedSolvedQuestionIds as string[]) : [];

  const currentIncorrect = Array.isArray(data.rankedIncorrectQuestionIds) ? (data.rankedIncorrectQuestionIds as string[]) : [];

  const checkpointFloor = Math.floor(Math.max(0, currentTrophies) / 100) * 100;
  const raw = currentTrophies + delta;
  const trophies = delta < 0 ? Math.max(checkpointFloor, raw, 0) : Math.max(raw, 0);

  const correctIds = correct
    ? (currentSolved.includes(questionId) ? currentSolved : Array.from(new Set([...currentSolved, questionId])))
    : currentSolved;

  const incorrectIds = correct
    ? currentIncorrect.filter((id) => id !== questionId)
    : (currentSolved.includes(questionId)
      ? currentIncorrect
      : (currentIncorrect.includes(questionId) ? currentIncorrect : Array.from(new Set([...currentIncorrect, questionId]))));

  await updateUserDoc(uid, 'program_progress', programId, {
    rankedTrophies: trophies,
    rankedSolvedQuestionIds: correctIds,
    rankedIncorrectQuestionIds: incorrectIds,
    updatedAt: now,
  });
  return { trophies, correctIds, incorrectIds };
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
