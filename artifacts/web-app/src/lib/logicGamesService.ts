import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { LogicGameNode, LogicGameQuestionsDoc, LogicGamesProgressDoc } from '@/types/logicGames';

const NODES_PUBLIC_COL = 'logic_game_nodes_public';
const NODES_DRAFT_COL = 'logic_game_nodes_draft';
const QUESTIONS_PUBLIC_COL = 'logic_game_questions_public';
const QUESTIONS_DRAFT_COL = 'logic_game_questions_draft';

export async function listPublishedLogicGameNodes(): Promise<LogicGameNode[]> {
  const q = query(collection(db, NODES_PUBLIC_COL), orderBy('order'));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<LogicGameNode, 'id'>) }))
    .filter((n) => typeof n.iq === 'number' && typeof n.order === 'number');
}

export async function getLogicGamesProgress(uid: string): Promise<LogicGamesProgressDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'logic_games_progress', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<LogicGamesProgressDoc>;
  return {
    id: 'global',
    iq: typeof data.iq === 'number' ? data.iq : 80,
    floorIq: typeof data.floorIq === 'number' ? data.floorIq : 80,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureLogicGamesProgress(uid: string): Promise<LogicGamesProgressDoc> {
  const existing = await getLogicGamesProgress(uid);
  if (existing) return existing;
  const now = new Date().toISOString();
  const init: LogicGamesProgressDoc = { id: 'global', iq: 80, floorIq: 80, updatedAt: now };
  await setDoc(doc(db, 'users', uid, 'logic_games_progress', 'global'), init);
  return init;
}

export async function setLogicGamesIq(uid: string, nextIq: number, nextFloorIq: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'logic_games_progress', 'global'), {
    iq: nextIq,
    floorIq: nextFloorIq,
    updatedAt: new Date().toISOString(),
  });
}

export async function listDraftLogicGameNodes(): Promise<LogicGameNode[]> {
  const q = query(collection(db, NODES_DRAFT_COL), orderBy('order'));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<LogicGameNode, 'id'>) }))
    .filter((n) => typeof n.iq === 'number' && typeof n.order === 'number');
}

export async function upsertDraftLogicGameNode(node: LogicGameNode): Promise<void> {
  await setDoc(doc(db, NODES_DRAFT_COL, node.id), {
    iq: node.iq,
    label: node.label,
    order: node.order,
    updatedAt: new Date().toISOString(),
  });
}

export async function publishLogicGameNode(nodeId: string): Promise<void> {
  const snap = await getDoc(doc(db, NODES_DRAFT_COL, nodeId));
  if (!snap.exists()) throw new Error('Draft node not found');
  const data = snap.data() as Omit<LogicGameNode, 'id'>;
  const now = new Date().toISOString();
  await setDoc(doc(db, NODES_PUBLIC_COL, nodeId), { ...data, publishedAt: now, updatedAt: now });
}

export async function getDraftLogicGameQuestions(nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  const snap = await getDoc(doc(db, QUESTIONS_DRAFT_COL, nodeId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<LogicGameQuestionsDoc>;
  return {
    nodeId,
    questions: Array.isArray((data as any).questions) ? ((data as any).questions as any[]) : [],
    updatedAt: typeof (data as any).updatedAt === 'string' ? ((data as any).updatedAt as string) : new Date().toISOString(),
    publishedAt: typeof (data as any).publishedAt === 'string' ? ((data as any).publishedAt as string) : undefined,
  };
}

export async function getPublishedLogicGameQuestions(nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  const snap = await getDoc(doc(db, QUESTIONS_PUBLIC_COL, nodeId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<LogicGameQuestionsDoc>;
  return {
    nodeId,
    questions: Array.isArray((data as any).questions) ? ((data as any).questions as any[]) : [],
    updatedAt: typeof (data as any).updatedAt === 'string' ? ((data as any).updatedAt as string) : new Date().toISOString(),
    publishedAt: typeof (data as any).publishedAt === 'string' ? ((data as any).publishedAt as string) : undefined,
  };
}

export async function upsertDraftLogicGameQuestions(nodeId: string, docData: Omit<LogicGameQuestionsDoc, 'nodeId'>): Promise<void> {
  await setDoc(doc(db, QUESTIONS_DRAFT_COL, nodeId), {
    ...docData,
    updatedAt: new Date().toISOString(),
  });
}

export async function publishLogicGameQuestions(nodeId: string): Promise<void> {
  const snap = await getDoc(doc(db, QUESTIONS_DRAFT_COL, nodeId));
  if (!snap.exists()) throw new Error('Draft questions not found');
  const data = snap.data() as Omit<LogicGameQuestionsDoc, 'nodeId'>;
  const now = new Date().toISOString();
  await setDoc(doc(db, QUESTIONS_PUBLIC_COL, nodeId), { ...data, updatedAt: now, publishedAt: now });
}
