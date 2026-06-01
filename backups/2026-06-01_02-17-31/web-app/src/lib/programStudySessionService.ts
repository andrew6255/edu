import { getGlobalDoc, setGlobalDoc, updateGlobalDoc, deleteGlobalDoc, queryGlobalDocs, listenGlobalDoc, listenGlobalCollection } from '@/lib/supabaseDocStore';
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
const MESSAGES_COL_PREFIX = 'programStudyMessages:';

export async function createProgramStudySession(args: {
  host: { uid: string; username: string };
  programId: string;
  regionId: string;
  questionTypeId: string;
  questionIds: string[];
}): Promise<ProgramStudySession> {
  let code = makeCode();
  for (let i = 0; i < 3; i++) {
    const existing = await getGlobalDoc(SESSIONS_COL, code);
    if (!existing) break;
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

  await setGlobalDoc(SESSIONS_COL, code, session as any);
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

  const raw = await getGlobalDoc(SESSIONS_COL, code);
  if (!raw) return null;

  const cur = raw as any as ProgramStudySession;
  if (cur.state === 'complete') return null;

  const participants = cur.participants ?? {};
  const existing = participants[args.participant.uid];

  const size = Object.keys(participants).length;
  if (!existing && size >= maxParticipants) return null;

  const t = nowIso();
  await updateGlobalDoc(SESSIONS_COL, code, {
    updatedAt: t,
    [`participants.${args.participant.uid}`]: {
      uid: args.participant.uid,
      username: args.participant.username,
      lastActiveAt: t,
    } satisfies ProgramStudyParticipant,
  });

  const updated = await getGlobalDoc(SESSIONS_COL, code);
  return updated ? (updated as any as ProgramStudySession) : null;
}

export function listenProgramStudySession(sessionId: string, cb: (s: ProgramStudySession) => void): () => void {
  getGlobalDoc(SESSIONS_COL, sessionId).then(d => { if (d) cb(d as any as ProgramStudySession); }).catch(() => {});
  return listenGlobalDoc(SESSIONS_COL, sessionId, (data) => {
    cb(data as any as ProgramStudySession);
  });
}

export function listenProgramStudyMessages(
  sessionId: string,
  cb: (messages: ProgramStudyMessage[]) => void,
  _opts?: { pageSize?: number }
): () => void {
  const msgCol = `${MESSAGES_COL_PREFIX}${sessionId}`;
  const fetchMsgs = () => queryGlobalDocs(msgCol)
    .then(rows => {
      const items = rows.map(r => ({ id: r.id, ...(r.data as any) } as ProgramStudyMessage))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      cb(items);
    })
    .catch(err => { console.warn('Program study messages fetch error:', err); cb([]); });

  fetchMsgs();
  return listenGlobalCollection(msgCol, [], (docs) => {
    const items = docs.map(d => ({ id: d.id, ...(d.data as any) } as ProgramStudyMessage))
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

  const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const msgCol = `${MESSAGES_COL_PREFIX}${args.sessionId}`;
  await setGlobalDoc(msgCol, msgId, {
    fromUid: args.fromUid,
    fromUsername: args.fromUsername,
    text,
    createdAt: nowIso(),
  });

  await updateGlobalDoc(SESSIONS_COL, args.sessionId, {
    updatedAt: nowIso(),
  });
}

export async function heartbeatProgramStudySession(sessionId: string, uid: string): Promise<void> {
  const t = nowIso();
  await updateGlobalDoc(SESSIONS_COL, sessionId, {
    updatedAt: t,
    [`participants.${uid}.lastActiveAt`]: t,
  });
}

export async function leaveProgramStudySession(sessionId: string, uid: string): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, sessionId);
  if (!raw) return;
  const cur = raw as any as ProgramStudySession;

  const participants = { ...(cur.participants ?? {}) };
  delete participants[uid];

  const nextState: ProgramStudySession['state'] = Object.keys(participants).length === 0 ? 'complete' : cur.state;

  await updateGlobalDoc(SESSIONS_COL, sessionId, {
    participants,
    state: nextState,
    updatedAt: nowIso(),
  });
}

export async function hostStartProgramStudySession(sessionId: string, hostUid: string): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, sessionId);
  if (!raw) return;
  const cur = raw as any as ProgramStudySession;
  if (cur.hostUid !== hostUid) return;
  if (cur.state === 'complete') return;
  await updateGlobalDoc(SESSIONS_COL, sessionId, { state: 'playing', updatedAt: nowIso() });
}

export async function hostSetReveal(sessionId: string, hostUid: string, reveal: boolean): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, sessionId);
  if (!raw) return;
  const cur = raw as any as ProgramStudySession;
  if (cur.hostUid !== hostUid) return;
  if (cur.state !== 'playing') return;
  await updateGlobalDoc(SESSIONS_COL, sessionId, { reveal, updatedAt: nowIso() });
}

export async function hostGoToIndex(sessionId: string, hostUid: string, index: number): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, sessionId);
  if (!raw) return;
  const cur = raw as any as ProgramStudySession;
  if (cur.hostUid !== hostUid) return;
  if (cur.state !== 'playing') return;

  const max = Math.max(0, (cur.questionIds?.length ?? 0) - 1);
  const nextIndex = Math.min(Math.max(0, index), max);

  await updateGlobalDoc(SESSIONS_COL, sessionId, {
    currentIndex: nextIndex,
    reveal: false,
    updatedAt: nowIso(),
  });
}

export async function submitProgramStudyAnswer(args: {
  sessionId: string;
  uid: string;
  questionId: string;
  answer: ProgramStudyAnswer;
}): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, args.sessionId);
  if (!raw) return;
  const session = raw as any as ProgramStudySession;
  if (session.state !== 'playing') return;

  const participants = session.participants ?? {};
  if (!participants[args.uid]) return;

  const curAnswersForQ = session.answers?.[args.questionId] ?? {};
  if (curAnswersForQ[args.uid]) return;

  const nextForQ = { ...curAnswersForQ, [args.uid]: args.answer };

  await updateGlobalDoc(SESSIONS_COL, args.sessionId, {
    updatedAt: nowIso(),
    [`answers.${args.questionId}`]: nextForQ,
    [`participants.${args.uid}.lastActiveAt`]: nowIso(),
  });
}

export async function tryCleanupInactiveProgramStudySession(sessionId: string, inactivityMs = 30_000): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, sessionId);
  if (!raw) return;
  const session = raw as any as ProgramStudySession;
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
    await updateGlobalDoc(SESSIONS_COL, sessionId, { participants: {}, state: 'complete', updatedAt: nowIso() });
    return;
  }

  if (Object.keys(next).length !== Object.keys(participants).length) {
    await updateGlobalDoc(SESSIONS_COL, sessionId, { participants: next, updatedAt: nowIso() });
  }
}

export async function deleteProgramStudySession(sessionId: string, uid: string): Promise<void> {
  const raw = await getGlobalDoc(SESSIONS_COL, sessionId);
  if (raw) {
    const cur = raw as any as ProgramStudySession;
    if (cur.hostUid !== uid) return;
    await updateGlobalDoc(SESSIONS_COL, sessionId, { state: 'complete', updatedAt: nowIso() });
  }

  try {
    await deleteGlobalDoc(SESSIONS_COL, sessionId);
  } catch {
    // ignore
  }
}
