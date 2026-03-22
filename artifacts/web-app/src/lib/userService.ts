import { db } from './firebase';
import {
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, deleteDoc
} from 'firebase/firestore';

export type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin';

export interface SubjectConfig {
  textbook: string;
  isVisible: boolean;
}

export interface CurriculumProfile {
  system: string;
  year: string;
  subjects: {
    mathematics: SubjectConfig;
    physics: SubjectConfig;
    chemistry: SubjectConfig;
    biology: SubjectConfig;
  };
}

export interface ArenaStats {
  wins: number;
  losses: number;
  highestStreak: number;
}

export interface UserData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: UserRole;
  organisationId?: string;
  classId?: string;
  economy: { gold: number; global_xp: number; streak: number };
  curriculums: Record<string, { trophies: number }>;
  curriculumProfile?: CurriculumProfile;
  onboardingComplete?: boolean;
  inventory: { stories: string[]; badges: string[]; banners: string[]; mapThemes: string[] };
  equipped: { mapTheme: string; banner: string; badges: string[] };
  high_scores: Record<string, number>;
  arenaStats?: ArenaStats;
  warmup_date?: string;
  played_categories?: string[];
  analytics?: Record<string, Record<string, { mastered?: boolean }>>;
  friends: string[];
  incomingRequests: string[];
  outgoingRequests: string[];
  rankedStats?: Record<string, { wins: number; losses: number; highestStreak: number; currentStreak?: number }>;
  progress?: Record<string, Record<string, Record<string, { mastered: boolean; xpAwarded: number; completedAt?: string }>>>;
  last_active?: string;
}

export interface AppNotification {
  id: string;
  fromUid: string;
  fromUsername: string;
  type: 'friendRequest' | 'system';
  message: string;
  createdAt: string;
  read: boolean;
}

export const SUPER_ADMIN_UID = 'SUPERADMIN_0000';

const DEFAULT_USER: Partial<UserData> = {
  role: 'student',
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  economy: { gold: 200, global_xp: 0, streak: 0 },
  arenaStats: { wins: 0, losses: 0, highestStreak: 0 },
  curriculums: {},
  inventory: { stories: [], badges: ['badge_pioneer'], banners: ['default'], mapThemes: ['theme-standard', 'theme-hex'] },
  equipped: { mapTheme: 'theme-standard', banner: 'default', badges: ['badge_pioneer'] },
  high_scores: {
    quickMath: 0, timeLimit: 0, numGrid: 0, blockPuzzle: 0, ticTacToe: 0,
    advQuickMath: 0, compareExp: 0, trueFalse: 0, missingOp: 0, fifteenPuzzle: 0,
    completeEq: 0, sequence: 0, memoOrder: 0, pyramid: 0, memoCells: 0,
    chessMemory: 0, nameSquare10: 0, nameSquare60: 0, findSquare10: 0, findSquare60: 0
  },
  warmup_date: '',
  played_categories: [],
  last_active: new Date().toISOString().split('T')[0]
};

export async function getUserData(uid: string): Promise<UserData | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return { ...DEFAULT_USER, ...snap.data() } as UserData;
}

export async function createUserData(uid: string, data: Partial<UserData>): Promise<void> {
  await setDoc(doc(db, 'users', uid), {
    ...DEFAULT_USER,
    ...data,
    last_active: new Date().toISOString().split('T')[0]
  });
}

export async function updateUserData(uid: string, updates: Partial<UserData>): Promise<void> {
  await updateDoc(doc(db, 'users', uid), updates as Record<string, unknown>);
}

export async function deleteUserData(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid));
}

export async function updateHighScore(uid: string, gameId: string, score: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { [`high_scores.${gameId}`]: score });
}

export async function updateEconomy(uid: string, goldDelta: number, xpDelta: number): Promise<void> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const data = snap.data();
  await updateDoc(doc(db, 'users', uid), {
    'economy.gold': Math.max(0, (data?.economy?.gold || 0) + goldDelta),
    'economy.global_xp': Math.max(0, (data?.economy?.global_xp || 0) + xpDelta),
    last_active: new Date().toISOString().split('T')[0]
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

export async function getAllUsers(): Promise<Array<UserData & { uid: string }>> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ uid: d.id, ...DEFAULT_USER, ...d.data() } as UserData & { uid: string }));
}

export async function getUsersByRole(role: UserRole): Promise<Array<UserData & { uid: string }>> {
  const q = query(collection(db, 'users'), where('role', '==', role));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...DEFAULT_USER, ...d.data() } as UserData & { uid: string }));
}

export async function getUsersByClassId(classId: string): Promise<Array<UserData & { uid: string }>> {
  const q = query(collection(db, 'users'), where('classId', '==', classId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...DEFAULT_USER, ...d.data() } as UserData & { uid: string }));
}

export async function getUsersByOrgId(orgId: string): Promise<Array<UserData & { uid: string }>> {
  const q = query(collection(db, 'users'), where('organisationId', '==', orgId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...DEFAULT_USER, ...d.data() } as UserData & { uid: string }));
}

export async function updateArenaStats(uid: string, won: boolean, sessionHighestStreak: number): Promise<void> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const data = snap.data();
  const current: ArenaStats = data?.arenaStats ?? { wins: 0, losses: 0, highestStreak: 0 };
  await updateDoc(doc(db, 'users', uid), {
    'arenaStats.wins': current.wins + (won ? 1 : 0),
    'arenaStats.losses': current.losses + (won ? 0 : 1),
    'arenaStats.highestStreak': Math.max(current.highestStreak, sessionHighestStreak),
    last_active: new Date().toISOString().split('T')[0]
  });
}

export async function updateRankedStats(uid: string, gameId: string, result: 'win' | 'loss' | 'draw'): Promise<void> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const data = snap.data();
  const current = data?.rankedStats?.[gameId] ?? { wins: 0, losses: 0, highestStreak: 0, currentStreak: 0 };
  
  if (result === 'draw') return;

  const won = result === 'win';
  const newCurrentStreak = won ? (current.currentStreak || 0) + 1 : 0;
  const newHighestStreak = Math.max(current.highestStreak || 0, newCurrentStreak);

  await updateDoc(doc(db, 'users', uid), {
    [`rankedStats.${gameId}.wins`]: current.wins + (won ? 1 : 0),
    [`rankedStats.${gameId}.losses`]: current.losses + (won ? 0 : 1),
    [`rankedStats.${gameId}.highestStreak`]: newHighestStreak,
    [`rankedStats.${gameId}.currentStreak`]: newCurrentStreak,
    last_active: new Date().toISOString().split('T')[0]
  });
}

export async function sendFriendRequest(fromUid: string, fromUsername: string, toUsername: string): Promise<boolean> {
  const q = query(collection(db, 'users'), where('username', '==', toUsername.toLowerCase().trim()));
  const snap = await getDocs(q);
  if (snap.empty) return false;
  
  const toUid = snap.docs[0].id;
  if (toUid === fromUid) return false;

  const { arrayUnion } = await import('firebase/firestore');
  await updateDoc(doc(db, 'users', toUid), { incomingRequests: arrayUnion(fromUid) });
  await updateDoc(doc(db, 'users', fromUid), { outgoingRequests: arrayUnion(toUid) });
  
  const notifRef = doc(collection(db, `users/${toUid}/notifications`));
  await setDoc(notifRef, {
    id: notifRef.id, fromUid, fromUsername, type: 'friendRequest',
    message: `${fromUsername} sent you a friend request.`, createdAt: new Date().toISOString(), read: false
  });
  return true;
}

export async function respondToFriendRequest(uid: string, peerUid: string, accept: boolean): Promise<void> {
  const { arrayRemove, arrayUnion } = await import('firebase/firestore');
  
  await updateDoc(doc(db, 'users', uid), { incomingRequests: arrayRemove(peerUid) });
  await updateDoc(doc(db, 'users', peerUid), { outgoingRequests: arrayRemove(uid) });
  
  if (accept) {
    await updateDoc(doc(db, 'users', uid), { friends: arrayUnion(peerUid) });
    await updateDoc(doc(db, 'users', peerUid), { friends: arrayUnion(uid) });
  }
}

export async function removeFriend(uid: string, peerUid: string): Promise<void> {
  const { arrayRemove } = await import('firebase/firestore');
  await updateDoc(doc(db, 'users', uid), { friends: arrayRemove(peerUid) });
  await updateDoc(doc(db, 'users', peerUid), { friends: arrayRemove(uid) });
}

export async function submitCurriculumRequest(uid: string, username: string, profile: {
  system: string; year: string; textbook: string;
}): Promise<void> {
  await setDoc(doc(db, 'curriculumRequests', `${uid}_${Date.now()}`), {
    uid, username, ...profile, requestedAt: new Date().toISOString(), status: 'pending'
  });
}

export function computeLevel(xp: number): { level: number; title: string } {
  const levels = [
    { min: 0, title: 'Initiate' }, { min: 500, title: 'Apprentice' }, { min: 1500, title: 'Seeker' },
    { min: 3000, title: 'Scholar' }, { min: 6000, title: 'Adept' }, { min: 10000, title: 'Expert' },
    { min: 15000, title: 'Master' }, { min: 25000, title: 'Grandmaster' }, { min: 50000, title: 'Logic Lord' }
  ];
  let level = 1; let title = 'Initiate';
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].min) { level = i + 1; title = levels[i].title; break; }
  }
  return { level, title };
}
