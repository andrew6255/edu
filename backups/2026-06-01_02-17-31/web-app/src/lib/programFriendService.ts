import { getGlobalDoc, setGlobalDoc, updateGlobalDoc, listenGlobalDoc } from '@/lib/supabaseDocStore';
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
  // Use the join code as the doc id so joining is a direct getDoc
  // (no list/query permissions needed).
  let code = makeCode();
  for (let i = 0; i < 3; i++) {
    const existing = await getGlobalDoc('programFriendSessions', code);
    if (!existing) break;
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

  await setGlobalDoc('programFriendSessions', code, session as any);
  return session;
}

export async function joinProgramFriendSessionByCode(args: {
  code: string;
  guest: ProgramFriendPlayer;
}): Promise<ProgramFriendSession | null> {
  const code = args.code.trim().toUpperCase();
  if (!code) return null;
  const id = code;
  const raw = await getGlobalDoc('programFriendSessions', id);
  if (!raw) return null;

  const cur = raw as any as ProgramFriendSession;
  if (cur.state !== 'waiting') return cur;
  if (cur.guest?.uid) return cur;
  if (cur.host.uid === args.guest.uid) return cur;

  await updateGlobalDoc('programFriendSessions', id, {
    guest: args.guest,
    state: 'playing',
    updatedAt: nowIso(),
    [`scores.${args.guest.uid}`]: 0,
  });

  const updated = await getGlobalDoc('programFriendSessions', id);
  return updated ? (updated as any as ProgramFriendSession) : null;
}

export function listenProgramFriendSession(sessionId: string, cb: (s: ProgramFriendSession) => void): () => void {
  getGlobalDoc('programFriendSessions', sessionId).then(d => { if (d) cb(d as any as ProgramFriendSession); }).catch(() => {});
  return listenGlobalDoc('programFriendSessions', sessionId, (data) => {
    cb(data as any as ProgramFriendSession);
  });
}

export async function submitProgramFriendAnswer(args: {
  sessionId: string;
  uid: string;
  questionId: string;
  answer: ProgramFriendAnswer;
}): Promise<void> {
  const raw = await getGlobalDoc('programFriendSessions', args.sessionId);
  if (!raw) return;
  const session = raw as any as ProgramFriendSession;
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

  await updateGlobalDoc('programFriendSessions', args.sessionId, baseUpdate);
}

export async function leaveProgramFriendSession(sessionId: string): Promise<void> {
  await updateGlobalDoc('programFriendSessions', sessionId, { state: 'complete', updatedAt: nowIso() });
}

export async function tryExpireWaitingProgramFriendSession(sessionId: string): Promise<void> {
  const raw = await getGlobalDoc('programFriendSessions', sessionId);
  if (!raw) return;
  const session = raw as any as ProgramFriendSession;
  if (session.state !== 'waiting') return;
  if (session.guest?.uid) return;
  await updateGlobalDoc('programFriendSessions', sessionId, { state: 'complete', updatedAt: nowIso() });
}

export async function tryCompleteInactiveProgramFriendSession(sessionId: string): Promise<void> {
  const raw = await getGlobalDoc('programFriendSessions', sessionId);
  if (!raw) return;
  const session = raw as any as ProgramFriendSession;
  if (session.state !== 'playing') return;
  await updateGlobalDoc('programFriendSessions', sessionId, { state: 'complete', updatedAt: nowIso() });
}
