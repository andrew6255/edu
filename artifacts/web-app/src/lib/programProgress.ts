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
  updatedAt: string;
};

export async function getProgramProgress(uid: string, programId: string): Promise<ProgramProgressDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'program_progress', programId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<ProgramProgressDoc>;
  return {
    programId,
    completedUnitIds: Array.isArray(data.completedUnitIds) ? (data.completedUnitIds as string[]) : [],
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
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    };
  }
  return out;
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
