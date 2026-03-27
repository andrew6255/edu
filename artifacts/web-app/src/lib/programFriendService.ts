import { db } from '@/lib/firebase';
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  Unsubscribe,
  runTransaction,
} from 'firebase/firestore';
import { ProgramFriendAnswer, ProgramFriendSession, ProgramFriendPlayer } from '@/types/programFriend';

function makeCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

export async function createProgramFriendSession(args: {
  host: ProgramFriendPlayer;
  programId: string;
  regionId: string;
  questionTypeId: string;
  questionIds: string[];
}): Promise<ProgramFriendSession> {
  // Use the join code as the Firestore doc id so joining is a direct getDoc
  // (no list/query permissions needed).
  let code = makeCode();
  for (let i = 0; i < 3; i++) {
    const existing = await getDoc(doc(db, 'programFriendSessions', code));
    if (!existing.exists()) break;
    code = makeCode();
  }

  const t = nowIso();
  const session: ProgramFriendSession = {
    id: code,
    code,
    programId: args.programId,
    regionId: args.regionId,
    questionTypeId: args.questionTypeId,
    state: 'waiting',
    host: args.host,
    guest: null,
    questionIds: args.questionIds,
    currentIndex: 0,
    createdAt: t,
    updatedAt: t,
    scores: { [args.host.uid]: 0 },
    answers: {},
  };

  await setDoc(doc(db, 'programFriendSessions', code), session);
  return session;
}

export async function joinProgramFriendSessionByCode(args: {
  code: string;
  guest: ProgramFriendPlayer;
}): Promise<ProgramFriendSession | null> {
  const code = args.code.trim().toUpperCase();
  if (!code) return null;
  const id = code;
  const pre = await getDoc(doc(db, 'programFriendSessions', id));
  if (!pre.exists()) return null;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'programFriendSessions', id);
    const curSnap = await tx.get(ref);
    if (!curSnap.exists()) return;
    const cur = curSnap.data() as ProgramFriendSession;
    if (cur.state !== 'waiting') return;
    if (cur.guest?.uid) return;
    if (cur.host.uid === args.guest.uid) return;

    tx.update(ref, {
      guest: args.guest,
      state: 'playing',
      updatedAt: nowIso(),
      [`scores.${args.guest.uid}`]: 0,
    });
  });

  const updated = await getDoc(doc(db, 'programFriendSessions', id));
  return updated.exists() ? (updated.data() as ProgramFriendSession) : null;
}

export function listenProgramFriendSession(sessionId: string, cb: (s: ProgramFriendSession) => void): Unsubscribe {
  return onSnapshot(doc(db, 'programFriendSessions', sessionId), (snap) => {
    if (!snap.exists()) return;
    cb(snap.data() as ProgramFriendSession);
  });
}

export async function submitProgramFriendAnswer(args: {
  sessionId: string;
  uid: string;
  questionId: string;
  answer: ProgramFriendAnswer;
}): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'programFriendSessions', args.sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const session = snap.data() as ProgramFriendSession;
    if (session.state !== 'playing') return;

    const curAnswersForQ = session.answers?.[args.questionId] ?? {};
    if (curAnswersForQ[args.uid]) return;

    const nextAnswersForQ = {
      ...curAnswersForQ,
      [args.uid]: args.answer,
    };

    const baseUpdate: Record<string, unknown> = {
      updatedAt: nowIso(),
      [`answers.${args.questionId}`]: nextAnswersForQ,
    };

    const scores = session.scores ?? {};
    const nextScores = { ...scores };
    if (args.answer.correct) nextScores[args.uid] = (nextScores[args.uid] ?? 0) + 1;
    baseUpdate[`scores.${args.uid}`] = nextScores[args.uid] ?? 0;

    const bothAnswered = !!session.host?.uid && !!session.guest?.uid && !!nextAnswersForQ[session.host.uid] && !!nextAnswersForQ[session.guest.uid];
    if (bothAnswered) {
      const nextIndex = Math.min(session.currentIndex + 1, Math.max(0, (session.questionIds?.length ?? 0) - 1));
      const isLast = session.currentIndex >= (session.questionIds?.length ?? 0) - 1;
      baseUpdate.currentIndex = isLast ? session.currentIndex : nextIndex;
      baseUpdate.state = isLast ? 'complete' : 'playing';
    }

    tx.update(ref, baseUpdate);
  });
}

export async function leaveProgramFriendSession(sessionId: string): Promise<void> {
  await updateDoc(doc(db, 'programFriendSessions', sessionId), { state: 'complete', updatedAt: nowIso() });
}

export async function tryExpireWaitingProgramFriendSession(sessionId: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'programFriendSessions', sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const session = snap.data() as ProgramFriendSession;
    if (session.state !== 'waiting') return;
    if (session.guest?.uid) return;
    tx.update(ref, { state: 'complete', updatedAt: nowIso() });
  });
}

export async function tryCompleteInactiveProgramFriendSession(sessionId: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'programFriendSessions', sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const session = snap.data() as ProgramFriendSession;
    if (session.state !== 'playing') return;
    tx.update(ref, { state: 'complete', updatedAt: nowIso() });
  });
}
