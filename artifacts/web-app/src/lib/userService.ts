import { db } from './firebase';
import {
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, arrayUnion
} from 'firebase/firestore';

export interface UserData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  economy: { gold: number; global_xp: number; streak: number };
  curriculums: Record<string, { trophies: number }>;
  inventory: { stories: string[]; badges: string[]; banners: string[]; mapThemes: string[] };
  equipped: { mapTheme: string; banner: string; badges: string[] };
  high_scores: Record<string, number>;
  warmup_date?: string;
  played_categories?: string[];
  analytics?: Record<string, Record<string, { mastered?: boolean }>>;
}

const DEFAULT_USER: Partial<UserData> = {
  economy: { gold: 0, global_xp: 0, streak: 0 },
  curriculums: {},
  inventory: { stories: [], badges: ['badge_pioneer'], banners: ['default'], mapThemes: ['theme-standard', 'theme-hex'] },
  equipped: { mapTheme: 'theme-standard', banner: 'default', badges: ['badge_pioneer'] },
  high_scores: {
    quickMath: 0, timeLimit: 0, numGrid: 0, blockPuzzle: 0, ticTacToe: 0,
    advQuickMath: 0, compareExp: 0, trueFalse: 0, missingOp: 0, fifteenPuzzle: 0,
    completeEq: 0, sequence: 0, memoOrder: 0, pyramid: 0, memoCells: 0,
    chessNameSurvival: 0, chessNameSpeed: 0, chessFindSurvival: 0, chessFindSpeed: 0, chessMemory: 0
  },
  warmup_date: '',
  played_categories: []
};

export async function getUserData(uid: string): Promise<UserData | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return { ...DEFAULT_USER, ...snap.data() } as UserData;
}

export async function createUserData(uid: string, data: Partial<UserData>): Promise<void> {
  await setDoc(doc(db, 'users', uid), { ...DEFAULT_USER, ...data });
}

export async function updateUserData(uid: string, updates: Partial<UserData>): Promise<void> {
  await updateDoc(doc(db, 'users', uid), updates as Record<string, unknown>);
}

export async function updateHighScore(uid: string, gameId: string, score: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { [`high_scores.${gameId}`]: score });
}

export async function updateEconomy(uid: string, goldDelta: number, xpDelta: number): Promise<void> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const data = snap.data();
  const currentGold = data?.economy?.gold || 0;
  const currentXP = data?.economy?.global_xp || 0;
  await updateDoc(doc(db, 'users', uid), {
    'economy.gold': currentGold + goldDelta,
    'economy.global_xp': currentXP + xpDelta
  });
}

export async function findUserByUsername(username: string): Promise<{ email: string } | null> {
  const q = query(collection(db, 'users'), where('username', '==', username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data() as { email: string };
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const q = query(collection(db, 'users'), where('username', '==', username));
  const snap = await getDocs(q);
  return !snap.empty;
}

export function computeLevel(xp: number): { level: number; title: string } {
  const levels = [
    { min: 0, title: 'Initiate' }, { min: 500, title: 'Apprentice' }, { min: 1500, title: 'Seeker' },
    { min: 3000, title: 'Scholar' }, { min: 6000, title: 'Adept' }, { min: 10000, title: 'Expert' },
    { min: 15000, title: 'Master' }, { min: 25000, title: 'Grandmaster' }, { min: 50000, title: 'Logic Lord' }
  ];
  let level = 1;
  let title = 'Initiate';
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].min) { level = i + 1; title = levels[i].title; break; }
  }
  return { level, title };
}
