import { db } from '@/lib/firebase';
import {
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  addDoc,
} from 'firebase/firestore';
import {
  ProgramStudyAnswer,
  ProgramStudyMessage,
  ProgramStudyParticipant,
  ProgramStudySession,
} from '@/types/programStudySession';

function nowIso() {
  return new Date().toISOString();
}

function makeCode(len = 5) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const SESSIONS_COL = 'programStudySessions';

export async function createProgramStudySession(args: {
  host: { uid: string; username: string };
  programId: string;
  regionId: string;
  questionTypeId: string;
  questionIds: string[];
}): Promise<ProgramStudySession> {
  let code = makeCode();
  for (let i = 0; i < 3; i++) {
    const existing = await getDoc(doc(db, SESSIONS_COL, code));
    if (!existing.exists()) break;
    code = makeCode();
  }

  const t = nowIso();
  const hostParticipant: ProgramStudyParticipant = {
    uid: args.host.uid,
    username: args.host.username,
    lastActiveAt: t,
  };

  const session: ProgramStudySession = {
    id: code,
    code,
    state: 'lobby',
    hostUid: args.host.uid,
    programId: args.programId,
    regionId: args.regionId,
    questionTypeId: args.questionTypeId,
    questionIds: args.questionIds,
    currentIndex: 0,
    reveal: false,
    participants: { [args.host.uid]: hostParticipant },
    answers: {},
    createdAt: t,
    updatedAt: t,
  };

  await setDoc(doc(db, SESSIONS_COL, code), session);
  return session;
}

export async function joinProgramStudySessionByCode(args: {
  code: string;
  participant: { uid: string; username: string };
  maxParticipants?: number;
}): Promise<ProgramStudySession | null> {
  const code = args.code.trim().toUpperCase();
  if (!code) return null;

  const maxParticipants = args.maxParticipants ?? 5;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, code);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const cur = snap.data() as ProgramStudySession;
    if (cur.state === 'complete') return;

    const participants = cur.participants ?? {};
    const existing = participants[args.participant.uid];

    const size = Object.keys(participants).length;
    if (!existing && size >= maxParticipants) return;

    const t = nowIso();
    tx.update(ref, {
      updatedAt: t,
      [`participants.${args.participant.uid}`]: {
        uid: args.participant.uid,
        username: args.participant.username,
        lastActiveAt: t,
      } satisfies ProgramStudyParticipant,
    });
  });

  const updated = await getDoc(doc(db, SESSIONS_COL, code));
  return updated.exists() ? (updated.data() as ProgramStudySession) : null;
}

export function listenProgramStudySession(sessionId: string, cb: (s: ProgramStudySession) => void): Unsubscribe {
  return onSnapshot(doc(db, SESSIONS_COL, sessionId), (snap) => {
    if (!snap.exists()) return;
    cb(snap.data() as ProgramStudySession);
  });
}

export function listenProgramStudyMessages(
  sessionId: string,
  cb: (messages: ProgramStudyMessage[]) => void,
  opts?: { pageSize?: number }
): Unsubscribe {
  const pageSize = opts?.pageSize ?? 50;
  const q = query(
    collection(db, SESSIONS_COL, sessionId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(pageSize)
  );
  return onSnapshot(q, (snap) => {
    const items = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ProgramStudyMessage, 'id'>) }))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    cb(items);
  });
}

export async function sendProgramStudyMessage(args: {
  sessionId: string;
  fromUid: string;
  fromUsername: string;
  text: string;
}): Promise<void> {
  const text = args.text.trim();
  if (!text) return;

  await addDoc(collection(db, SESSIONS_COL, args.sessionId, 'messages'), {
    fromUid: args.fromUid,
    fromUsername: args.fromUsername,
    text,
    createdAt: nowIso(),
    createdAtTs: serverTimestamp(),
  });

  await updateDoc(doc(db, SESSIONS_COL, args.sessionId), {
    updatedAt: nowIso(),
  });
}

export async function heartbeatProgramStudySession(sessionId: string, uid: string): Promise<void> {
  const t = nowIso();
  await updateDoc(doc(db, SESSIONS_COL, sessionId), {
    updatedAt: t,
    [`participants.${uid}.lastActiveAt`]: t,
  });
}

export async function leaveProgramStudySession(sessionId: string, uid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data() as ProgramStudySession;

    const participants = { ...(cur.participants ?? {}) };
    delete participants[uid];

    const nextState: ProgramStudySession['state'] = Object.keys(participants).length === 0 ? 'complete' : cur.state;

    tx.update(ref, {
      participants,
      state: nextState,
      updatedAt: nowIso(),
    });
  });
}

export async function hostStartProgramStudySession(sessionId: string, hostUid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data() as ProgramStudySession;
    if (cur.hostUid !== hostUid) return;
    if (cur.state === 'complete') return;

    tx.update(ref, { state: 'playing', updatedAt: nowIso() });
  });
}

export async function hostSetReveal(sessionId: string, hostUid: string, reveal: boolean): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data() as ProgramStudySession;
    if (cur.hostUid !== hostUid) return;
    if (cur.state !== 'playing') return;

    tx.update(ref, { reveal, updatedAt: nowIso() });
  });
}

export async function hostGoToIndex(sessionId: string, hostUid: string, index: number): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data() as ProgramStudySession;
    if (cur.hostUid !== hostUid) return;
    if (cur.state !== 'playing') return;

    const max = Math.max(0, (cur.questionIds?.length ?? 0) - 1);
    const nextIndex = Math.min(Math.max(0, index), max);

    tx.update(ref, {
      currentIndex: nextIndex,
      reveal: false,
      updatedAt: nowIso(),
    });
  });
}

export async function submitProgramStudyAnswer(args: {
  sessionId: string;
  uid: string;
  questionId: string;
  answer: ProgramStudyAnswer;
}): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, args.sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const session = snap.data() as ProgramStudySession;
    if (session.state !== 'playing') return;

    const participants = session.participants ?? {};
    if (!participants[args.uid]) return;

    const curAnswersForQ = session.answers?.[args.questionId] ?? {};
    if (curAnswersForQ[args.uid]) return;

    const nextForQ = { ...curAnswersForQ, [args.uid]: args.answer };

    tx.update(ref, {
      updatedAt: nowIso(),
      [`answers.${args.questionId}`]: nextForQ,
      [`participants.${args.uid}.lastActiveAt`]: nowIso(),
    });
  });
}

export async function tryCleanupInactiveProgramStudySession(sessionId: string, inactivityMs = 30_000): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const session = snap.data() as ProgramStudySession;
    if (session.state === 'complete') return;

    const now = Date.now();
    const participants = session.participants ?? {};

    const next: Record<string, ProgramStudyParticipant> = {};
    for (const [uid, p] of Object.entries(participants)) {
      const ts = Date.parse(p.lastActiveAt);
      if (!Number.isFinite(ts) || now - ts <= inactivityMs) {
        next[uid] = p;
      }
    }

    if (Object.keys(next).length === 0) {
      tx.update(ref, { participants: {}, state: 'complete', updatedAt: nowIso() });
      return;
    }

    if (Object.keys(next).length !== Object.keys(participants).length) {
      tx.update(ref, { participants: next, updatedAt: nowIso() });
    }
  });
}

export async function deleteProgramStudySession(sessionId: string, uid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, SESSIONS_COL, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data() as ProgramStudySession;
    if (cur.hostUid !== uid) return;
    tx.update(ref, { state: 'complete', updatedAt: nowIso() });
  });

  // Best-effort hard delete for disposability (will require rules support).
  try {
    await deleteDoc(doc(db, SESSIONS_COL, sessionId));
  } catch {
    // ignore
  }
}
