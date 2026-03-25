import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

export type ProgramProgressDoc = {
  programId: string;
  completedUnitIds: string[];
  solvedQuestionIds?: string[];
  rankedTrophies?: number;
  rankedSolvedQuestionIds?: string[];
  updatedAt: string;
};

export async function getProgramProgress(uid: string, programId: string): Promise<ProgramProgressDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'program_progress', programId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<ProgramProgressDoc>;
  return {
    programId,
    completedUnitIds: Array.isArray(data.completedUnitIds) ? (data.completedUnitIds as string[]) : [],
    solvedQuestionIds: Array.isArray((data as any).solvedQuestionIds) ? ((data as any).solvedQuestionIds as string[]) : [],
    rankedTrophies: typeof (data as any).rankedTrophies === 'number' ? ((data as any).rankedTrophies as number) : 0,
    rankedSolvedQuestionIds: Array.isArray((data as any).rankedSolvedQuestionIds) ? ((data as any).rankedSolvedQuestionIds as string[]) : [],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function listProgramProgress(uid: string): Promise<Record<string, ProgramProgressDoc>> {
  const snap = await getDocs(collection(db, 'users', uid, 'program_progress'));
  const out: Record<string, ProgramProgressDoc> = {};
  for (const d of snap.docs) {
    const data = d.data() as Partial<ProgramProgressDoc>;
    out[d.id] = {
      programId: d.id,
      completedUnitIds: Array.isArray(data.completedUnitIds) ? (data.completedUnitIds as string[]) : [],
      solvedQuestionIds: Array.isArray((data as any).solvedQuestionIds) ? ((data as any).solvedQuestionIds as string[]) : [],
      rankedTrophies: typeof (data as any).rankedTrophies === 'number' ? ((data as any).rankedTrophies as number) : 0,
      rankedSolvedQuestionIds: Array.isArray((data as any).rankedSolvedQuestionIds) ? ((data as any).rankedSolvedQuestionIds as string[]) : [],
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    };
  }
  return out;
}

export async function markQuestionSolved(uid: string, programId: string, questionId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'program_progress', programId);
  const snap = await getDoc(ref);
  const now = new Date().toISOString();

  if (!snap.exists()) {
    await setDoc(ref, {
      programId,
      completedUnitIds: [],
      solvedQuestionIds: [questionId],
      updatedAt: now,
    } satisfies ProgramProgressDoc);
    return;
  }

  const data = snap.data() as { solvedQuestionIds?: unknown };
  const current = Array.isArray(data.solvedQuestionIds) ? (data.solvedQuestionIds as string[]) : [];
  if (current.includes(questionId)) {
    await updateDoc(ref, { updatedAt: now });
    return;
  }
  await updateDoc(ref, { solvedQuestionIds: Array.from(new Set([...current, questionId])), updatedAt: now });
}

export async function applyRankedAnswer(
  uid: string,
  programId: string,
  questionId: string,
  correct: boolean,
  trophyDeltaCorrect = 15,
  trophyDeltaWrong = -15
): Promise<{ trophies: number; solvedIds: string[] }> {
  const ref = doc(db, 'users', uid, 'program_progress', programId);
  const snap = await getDoc(ref);
  const now = new Date().toISOString();

  if (!snap.exists()) {
    const raw = correct ? trophyDeltaCorrect : trophyDeltaWrong;
    const trophies = Math.max(0, raw);
    const solvedIds = correct ? [questionId] : [];
    await setDoc(ref, {
      programId,
      completedUnitIds: [],
      solvedQuestionIds: [],
      rankedTrophies: trophies,
      rankedSolvedQuestionIds: solvedIds,
      updatedAt: now,
    } satisfies ProgramProgressDoc);
    return { trophies, solvedIds };
  }

  const data = snap.data() as {
    rankedTrophies?: unknown;
    rankedSolvedQuestionIds?: unknown;
  };
  const currentTrophies = typeof data.rankedTrophies === 'number' ? (data.rankedTrophies as number) : 0;
  const currentSolved = Array.isArray(data.rankedSolvedQuestionIds) ? (data.rankedSolvedQuestionIds as string[]) : [];

  const delta = correct ? trophyDeltaCorrect : trophyDeltaWrong;
  const checkpointFloor = Math.floor(Math.max(0, currentTrophies) / 100) * 100;
  const raw = currentTrophies + delta;
  const trophies = Math.max(checkpointFloor, raw, 0);
  const solvedIds = correct
    ? (currentSolved.includes(questionId) ? currentSolved : Array.from(new Set([...currentSolved, questionId])))
    : currentSolved;

  await updateDoc(ref, { rankedTrophies: trophies, rankedSolvedQuestionIds: solvedIds, updatedAt: now });
  return { trophies, solvedIds };
}

export async function toggleUnitComplete(uid: string, programId: string, unitId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'program_progress', programId);
  const snap = await getDoc(ref);
  const now = new Date().toISOString();

  if (!snap.exists()) {
    await setDoc(ref, {
      programId,
      completedUnitIds: [unitId],
      updatedAt: now,
    } satisfies ProgramProgressDoc);
    return;
  }

  const data = snap.data() as { completedUnitIds?: unknown };
  const current = Array.isArray(data.completedUnitIds) ? (data.completedUnitIds as string[]) : [];
  const next = current.includes(unitId) ? current.filter((x) => x !== unitId) : Array.from(new Set([...current, unitId]));
  await updateDoc(ref, { completedUnitIds: next, updatedAt: now });
}
