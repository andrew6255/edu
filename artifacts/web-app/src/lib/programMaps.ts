import { getDraftProgram } from '@/lib/draftProgramStore';
import { getDraftProgramAdmin, getPublishedProgramAdmin, listProgramsAdmin } from '@/lib/programAdminService';
import { getUserData, updateUserData } from '@/lib/userService';
import { deleteUserDoc } from '@/lib/supabaseDocStore';

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

function toPublicProgram(data: Partial<PublicProgram> & { id: string }): PublicProgram | null {
  const toc = data.toc as TocData | undefined;
  if (!toc || !Array.isArray(toc.toc_tree)) return null;
  if (typeof (data as any).deletedAt === 'string' && (data as any).deletedAt) return null;
  return {
    id: data.id,
    title: (data.title as string) ?? data.id,
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

export async function getDraftProgramFromDb(programId: string): Promise<PublicProgram | null> {
  const data = await getDraftProgramAdmin(programId);
  if (!data) return null;
  return toPublicProgram(data as Partial<PublicProgram> & { id: string });
}

export async function listPublicPrograms(): Promise<PublicProgram[]> {
  const rows = await listProgramsAdmin('published');
  return rows
    .map((row) => toPublicProgram(row as Partial<PublicProgram> & { id: string }))
    .filter((p): p is PublicProgram => !!p);
}

export async function getPublicProgram(programId: string): Promise<PublicProgram | null> {
  const data = await getPublishedProgramAdmin(programId);
  if (!data) return null;
  return toPublicProgram(data as Partial<PublicProgram> & { id: string });
}

export async function getPublicProgramOrDraft(programId: string): Promise<PublicProgram | null> {
  const prefix = 'll-draft:';
  if (programId.startsWith(prefix)) {
    const key = programId.slice(prefix.length);
    const p = getDraftProgram(key);
    if (!p) return null;
    return { ...p, draftKey: key };
  }
  const dbPrefix = 'll-draftdb:';
  if (programId.startsWith(dbPrefix)) {
    const id = programId.slice(dbPrefix.length);
    return getDraftProgramFromDb(id);
  }
  return getPublicProgram(programId);
}

export async function purgeProgramFromUser(uid: string, programId: string): Promise<void> {
  const data = await getUserData(uid);
  if (!data) return;

  const assigned = Array.isArray(data.assignedProgramIds) ? data.assignedProgramIds : [];
  const activeIds = Array.isArray(data.activeProgramIds)
    ? data.activeProgramIds
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId] : []);
  const completed = Array.isArray(data.completedProgramIds) ? data.completedProgramIds : [];

  const nextAssigned = assigned.filter((x) => x !== programId);
  const nextActive = activeIds.filter((x) => x !== programId);
  const nextCompleted = completed.filter((x) => x !== programId);
  const nextPrimary = nextActive.length > 0 ? nextActive[0] : null;

  await updateUserData(uid, {
    assignedProgramIds: nextAssigned,
    activeProgramIds: nextActive,
    activeProgramId: nextPrimary,
    completedProgramIds: nextCompleted,
  });

  // Best-effort progress cleanup for this user.
  try { await deleteUserDoc(uid, 'program_progress', programId); } catch {}
}

export async function assignProgramToUser(uid: string, programId: string): Promise<void> {
  const data = await getUserData(uid);
  if (!data) return;
  const current = Array.isArray(data.assignedProgramIds) ? data.assignedProgramIds : [];
  const next = Array.from(new Set([...current, programId]));
  await updateUserData(uid, { assignedProgramIds: next });
}

export async function activateProgramForUser(uid: string, programId: string | null): Promise<void> {
  await updateUserData(uid, { activeProgramId: programId });
}

export async function toggleActiveProgramForUser(uid: string, programId: string): Promise<void> {
  const data = await getUserData(uid);
  if (!data) return;

  const current = Array.isArray(data.activeProgramIds)
    ? data.activeProgramIds
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId] : []);

  const exists = current.includes(programId);
  const next = exists ? current.filter((x) => x !== programId) : Array.from(new Set([...current, programId]));
  const primary = next.length > 0 ? next[0] : null;

  await updateUserData(uid, {
    activeProgramIds: next,
    activeProgramId: primary,
  });
}

export async function removeProgramFromUser(uid: string, programId: string): Promise<void> {
  const data = await getUserData(uid);
  if (!data) return;

  const assigned = Array.isArray(data.assignedProgramIds) ? data.assignedProgramIds : [];
  const completed = Array.isArray(data.completedProgramIds) ? data.completedProgramIds : [];
  const active = Array.isArray(data.activeProgramIds)
    ? data.activeProgramIds
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId] : []);

  const nextAssigned = assigned.filter((x) => x !== programId);
  const nextCompleted = completed.filter((x) => x !== programId);
  const nextActive = active.filter((x) => x !== programId);
  const primary = nextActive.length > 0 ? nextActive[0] : null;

  await updateUserData(uid, {
    assignedProgramIds: nextAssigned,
    completedProgramIds: nextCompleted,
    activeProgramIds: nextActive,
    activeProgramId: primary,
  });
}

export async function setProgramCompletedForUser(uid: string, programId: string, completed: boolean): Promise<void> {
  const data = await getUserData(uid);
  if (!data) return;

  const curCompleted = Array.isArray(data.completedProgramIds) ? data.completedProgramIds : [];
  const nextCompleted = completed
    ? Array.from(new Set([...curCompleted, programId]))
    : curCompleted.filter((x) => x !== programId);

  // If completed, remove from active lists (optional UX expectation)
  const curActive = Array.isArray(data.activeProgramIds)
    ? data.activeProgramIds
    : (typeof data.activeProgramId === 'string' && data.activeProgramId ? [data.activeProgramId] : []);

  const nextActive = completed ? curActive.filter((x) => x !== programId) : curActive;
  const primary = nextActive.length > 0 ? nextActive[0] : null;

  await updateUserData(uid, {
    completedProgramIds: nextCompleted,
    activeProgramIds: nextActive,
    activeProgramId: primary,
  });
}
