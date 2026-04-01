import { db } from '@/lib/firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
} from 'firebase/firestore';
import { getDraftProgram } from '@/lib/draftProgramStore';

export type TocItem = {
  id: string;
  title: string;
  level: number;
  ref?: string | null;
  page_range?: [number | null, number | null] | null;
  children?: TocItem[];
};

export type TocData = {
  program_id: string;
  program_title?: string | null;
  source?: { file_name?: string | null; page_range?: [number | null, number | null] };
  toc_tree: TocItem[];
  toc_notes?: string[];
};

export type PublicProgram = {
  id: string;
  title: string;
  subject?: string;
  grade_band?: string;
  coverEmoji?: string;
  questionBankPath?: string;
  annotationsPath?: string;
  questionBank?: unknown;
  questionBanksByChapter?: unknown;
  rankedTotalQuestionCount?: number;
  annotations?: unknown;
  programMeta?: unknown;
  toc: TocData;
  deletedAt?: string;
  draftKey?: string;
};

export async function listPublicPrograms(): Promise<PublicProgram[]> {
  const snap = await getDocs(query(collection(db, 'public_programs')));
  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<PublicProgram>;
      return {
        id: d.id,
        title: (data.title as string) ?? d.id,
        subject: data.subject,
        grade_band: data.grade_band,
        coverEmoji: data.coverEmoji,
        questionBankPath: typeof (data as any).questionBankPath === 'string' ? ((data as any).questionBankPath as string) : undefined,
        annotationsPath: typeof (data as any).annotationsPath === 'string' ? ((data as any).annotationsPath as string) : undefined,
        questionBank: (data as any).questionBank,
        questionBanksByChapter: (data as any).questionBanksByChapter,
        rankedTotalQuestionCount: typeof (data as any).rankedTotalQuestionCount === 'number' ? ((data as any).rankedTotalQuestionCount as number) : undefined,
        annotations: (data as any).annotations,
        programMeta: (data as any).programMeta,
        toc: (data.toc as TocData)!,
        deletedAt: typeof (data as any).deletedAt === 'string' ? ((data as any).deletedAt as string) : undefined,
      } satisfies PublicProgram;
    })
    .filter((p) => !!p.toc && Array.isArray(p.toc.toc_tree))
    .filter((p) => !p.deletedAt);
}

export async function getPublicProgram(programId: string): Promise<PublicProgram | null> {
  const snap = await getDoc(doc(db, 'public_programs', programId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<PublicProgram>;
  if (typeof (data as any).deletedAt === 'string' && (data as any).deletedAt) return null;
  const toc = data.toc as TocData | undefined;
  if (!toc || !Array.isArray(toc.toc_tree)) return null;
  return {
    id: snap.id,
    title: (data.title as string) ?? snap.id,
    subject: data.subject,
    grade_band: data.grade_band,
    coverEmoji: data.coverEmoji,
    questionBankPath: typeof (data as any).questionBankPath === 'string' ? ((data as any).questionBankPath as string) : undefined,
    annotationsPath: typeof (data as any).annotationsPath === 'string' ? ((data as any).annotationsPath as string) : undefined,
    questionBank: (data as any).questionBank,
    questionBanksByChapter: (data as any).questionBanksByChapter,
    rankedTotalQuestionCount: typeof (data as any).rankedTotalQuestionCount === 'number' ? ((data as any).rankedTotalQuestionCount as number) : undefined,
    annotations: (data as any).annotations,
    programMeta: (data as any).programMeta,
    toc,
    deletedAt: typeof (data as any).deletedAt === 'string' ? ((data as any).deletedAt as string) : undefined,
  };
}

export async function getPublicProgramOrDraft(programId: string): Promise<PublicProgram | null> {
  const prefix = 'll-draft:';
  if (programId.startsWith(prefix)) {
    const key = programId.slice(prefix.length);
    const p = getDraftProgram(key);
    if (!p) return null;
    return { ...p, draftKey: key };
  }
  return getPublicProgram(programId);
}

export async function purgeProgramFromUser(uid: string, programId: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const data = userSnap.data() as {
    assignedProgramIds?: unknown;
    activeProgramIds?: unknown;
    activeProgramId?: unknown;
    completedProgramIds?: unknown;
  };

  const assigned = Array.isArray(data.assignedProgramIds) ? (data.assignedProgramIds as string[]) : [];
  const activeIds = Array.isArray(data.activeProgramIds)
    ? (data.activeProgramIds as string[])
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId as string] : []);
  const completed = Array.isArray(data.completedProgramIds) ? (data.completedProgramIds as string[]) : [];

  const nextAssigned = assigned.filter((x) => x !== programId);
  const nextActive = activeIds.filter((x) => x !== programId);
  const nextCompleted = completed.filter((x) => x !== programId);
  const nextPrimary = nextActive.length > 0 ? nextActive[0] : null;

  await updateDoc(userRef, {
    assignedProgramIds: nextAssigned,
    activeProgramIds: nextActive,
    activeProgramId: nextPrimary,
    completedProgramIds: nextCompleted,
  });

  // Best-effort progress cleanup for this user.
  await deleteDoc(doc(db, 'users', uid, 'program_progress', programId));
}

export async function assignProgramToUser(uid: string, programId: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;
  const data = userSnap.data() as { assignedProgramIds?: unknown };
  const current = Array.isArray(data.assignedProgramIds) ? (data.assignedProgramIds as string[]) : [];
  const next = Array.from(new Set([...current, programId]));
  await updateDoc(userRef, { assignedProgramIds: next });
}

export async function activateProgramForUser(uid: string, programId: string | null): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { activeProgramId: programId });
}

export async function toggleActiveProgramForUser(uid: string, programId: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const data = userSnap.data() as { activeProgramIds?: unknown; activeProgramId?: unknown };

  const current = Array.isArray(data.activeProgramIds)
    ? (data.activeProgramIds as string[])
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId as string] : []);

  const exists = current.includes(programId);
  const next = exists ? current.filter((x) => x !== programId) : Array.from(new Set([...current, programId]));
  const primary = next.length > 0 ? next[0] : null;

  await updateDoc(userRef, {
    activeProgramIds: next,
    activeProgramId: primary,
  });
}

export async function removeProgramFromUser(uid: string, programId: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const data = userSnap.data() as {
    assignedProgramIds?: unknown;
    activeProgramIds?: unknown;
    activeProgramId?: unknown;
    completedProgramIds?: unknown;
  };

  const assigned = Array.isArray(data.assignedProgramIds) ? (data.assignedProgramIds as string[]) : [];
  const completed = Array.isArray(data.completedProgramIds) ? (data.completedProgramIds as string[]) : [];
  const active = Array.isArray(data.activeProgramIds)
    ? (data.activeProgramIds as string[])
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId as string] : []);

  const nextAssigned = assigned.filter((x) => x !== programId);
  const nextCompleted = completed.filter((x) => x !== programId);
  const nextActive = active.filter((x) => x !== programId);
  const primary = nextActive.length > 0 ? nextActive[0] : null;

  await updateDoc(userRef, {
    assignedProgramIds: nextAssigned,
    completedProgramIds: nextCompleted,
    activeProgramIds: nextActive,
    activeProgramId: primary,
  });
}

export async function setProgramCompletedForUser(uid: string, programId: string, completed: boolean): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const data = userSnap.data() as {
    completedProgramIds?: unknown;
    activeProgramIds?: unknown;
    activeProgramId?: unknown;
  };

  const curCompleted = Array.isArray(data.completedProgramIds) ? (data.completedProgramIds as string[]) : [];
  const nextCompleted = completed
    ? Array.from(new Set([...curCompleted, programId]))
    : curCompleted.filter((x) => x !== programId);

  // If completed, remove from active lists (optional UX expectation)
  const curActive = Array.isArray(data.activeProgramIds)
    ? (data.activeProgramIds as string[])
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId as string] : []);

  const nextActive = completed ? curActive.filter((x) => x !== programId) : curActive;
  const primary = nextActive.length > 0 ? nextActive[0] : null;

  await updateDoc(userRef, {
    completedProgramIds: nextCompleted,
    activeProgramIds: nextActive,
    activeProgramId: primary,
  });
}
