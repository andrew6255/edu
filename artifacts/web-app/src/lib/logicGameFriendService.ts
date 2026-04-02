import { db } from '@/lib/firebase';
import {
  Unsubscribe,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { LogicGameFriendMatch } from '@/types/logicGameFriend';
import type { LogicGameQuestion } from '@/types/logicGames';
import { getPublishedLogicGameQuestions } from '@/lib/logicGamesService';
import { sendChallenge } from '@/lib/gameSessionService';

function nowIso() {
  return new Date().toISOString();
}

function makeId(len = 10) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function sendLogicGameFriendChallenge(args: {
  fromUid: string;
  fromUsername: string;
  toUsername: string;
  nodeId: string;
  nodeLabel: string;
}): Promise<{ success: boolean; challengeId?: string; error?: string }> {
  // Reuse challenges/notifications infra.
  return sendChallenge(
    args.fromUid,
    args.fromUsername,
    args.toUsername,
    `logicGame:${args.nodeId}`,
    `Logic Games · ${args.nodeLabel}`,
    { kind: 'logicGame', logicGameNodeId: args.nodeId }
  );
}

export async function createLogicGameFriendMatch(args: {
  matchId?: string;
  nodeId: string;
  host: { uid: string; username: string };
  guest: { uid: string; username: string };
}): Promise<LogicGameFriendMatch> {
  const matchId = args.matchId ?? makeId();

  const qdoc = await getPublishedLogicGameQuestions(args.nodeId);
  const questions = Array.isArray(qdoc?.questions) ? (qdoc!.questions as LogicGameQuestion[]) : [];
  if (questions.length === 0) throw new Error('No published questions for this node');

  const questionIds = shuffle(questions.map((q) => q.id).filter((id) => typeof id === 'string' && id.trim()));
  const q0id = questionIds[0];
  const q0 = questions.find((q) => q.id === q0id) ?? questions[0];
  const startedAt = nowIso();
  const deadlineAt = new Date(Date.now() + Math.max(1, Math.floor(q0.timeLimitSec)) * 1000).toISOString();

  const match: LogicGameFriendMatch = {
    id: matchId,
    nodeId: args.nodeId,
    state: 'playing',

    hostUid: args.host.uid,
    hostUsername: args.host.username,
    guestUid: args.guest.uid,
    guestUsername: args.guest.username,

    questionIds,
    questionPtr: 0,

    hostWins: 0,
    guestWins: 0,

    currentRound: {
      roundIndex: 0,
      questionId: q0.id,
      startedAt,
      deadlineAt,
      attempts: {},
      winnerUid: null,
    },

    createdAt: startedAt,
    updatedAt: startedAt,
  };

  await setDoc(doc(db, 'logicGameFriendMatches', matchId), match);
  return match;
}

export function listenLogicGameFriendMatch(matchId: string, cb: (m: LogicGameFriendMatch) => void): Unsubscribe {
  return onSnapshot(doc(db, 'logicGameFriendMatches', matchId), (snap) => {
    if (!snap.exists()) return;
    cb(snap.data() as LogicGameFriendMatch);
  });
}

function isParticipant(match: LogicGameFriendMatch, uid: string) {
  return match.hostUid === uid || match.guestUid === uid;
}

function uidToKey(match: LogicGameFriendMatch, uid: string): 'host' | 'guest' | null {
  if (match.hostUid === uid) return 'host';
  if (match.guestUid === uid) return 'guest';
  return null;
}

export async function submitLogicGameFriendAttempt(args: {
  matchId: string;
  uid: string;
  status: 'correct' | 'wrong' | 'timeout';
}): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'logicGameFriendMatches', args.matchId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const match = snap.data() as LogicGameFriendMatch;
    if (match.state !== 'playing') return;
    if (!isParticipant(match, args.uid)) return;

    const round = match.currentRound;
    const attempts = { ...(round.attempts ?? {}) };
    if (attempts[args.uid]) return;

    attempts[args.uid] = { status: args.status, answeredAt: nowIso() };

    // Resolve rules:
    // - If someone is correct -> they win point immediately.
    // - If both wrong/timeout -> new question same round (no point).
    const hostAttempt = attempts[match.hostUid] ?? null;
    const guestAttempt = attempts[match.guestUid] ?? null;

    let nextMatch: Partial<LogicGameFriendMatch> & Record<string, unknown> = {
      updatedAt: nowIso(),
      'currentRound.attempts': attempts,
    };

    const someoneCorrect = (hostAttempt?.status === 'correct') || (guestAttempt?.status === 'correct');

    if (someoneCorrect) {
      const winnerUid = hostAttempt?.status === 'correct' ? match.hostUid : match.guestUid;
      const hostWins = (match.hostWins ?? 0) + (winnerUid === match.hostUid ? 1 : 0);
      const guestWins = (match.guestWins ?? 0) + (winnerUid === match.guestUid ? 1 : 0);
      const matchOver = hostWins >= 3 || guestWins >= 3;

      nextMatch = {
        ...nextMatch,
        hostWins,
        guestWins,
        'currentRound.winnerUid': winnerUid,
        state: matchOver ? 'complete' : 'playing',
      };

      if (!matchOver) {
        const nextRoundIndex = (round.roundIndex ?? 0) + 1;
        const nextPtr = ((match.questionPtr ?? 0) + 1) % Math.max(1, (match.questionIds ?? []).length);
        const nextQid = (match.questionIds ?? [round.questionId])[nextPtr] ?? round.questionId;

        // deadline will be recomputed client-side by submitting a timeout attempt if needed.
        // We keep a default 30s if missing; actual per-question time comes from question doc in UI.
        const startedAt = nowIso();
        const deadlineAt = new Date(Date.now() + 30 * 1000).toISOString();

        nextMatch = {
          ...nextMatch,
          questionPtr: nextPtr,
          currentRound: {
            roundIndex: nextRoundIndex,
            questionId: nextQid,
            startedAt,
            deadlineAt,
            attempts: {},
            winnerUid: null,
          },
        };
      }

      tx.update(ref, nextMatch);
      return;
    }

    const bothFailed = !!hostAttempt && !!guestAttempt;
    if (bothFailed) {
      const nextPtr = ((match.questionPtr ?? 0) + 1) % Math.max(1, (match.questionIds ?? []).length);
      const nextQid = (match.questionIds ?? [round.questionId])[nextPtr] ?? round.questionId;
      const startedAt = nowIso();
      const deadlineAt = new Date(Date.now() + 30 * 1000).toISOString();

      tx.update(ref, {
        ...nextMatch,
        questionPtr: nextPtr,
        currentRound: {
          roundIndex: round.roundIndex ?? 0,
          questionId: nextQid,
          startedAt,
          deadlineAt,
          attempts: {},
          winnerUid: null,
        },
      });
      return;
    }

    tx.update(ref, nextMatch);
  });
}

export async function bumpLogicGameFriendDeadline(args: {
  matchId: string;
  uid: string;
  deadlineAt: string;
}): Promise<void> {
  // Participants may update deadline at start of a round; used to set per-question timeLimitSec.
  const ref = doc(db, 'logicGameFriendMatches', args.matchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const match = snap.data() as LogicGameFriendMatch;
  if (!isParticipant(match, args.uid)) return;
  await updateDoc(ref, { 'currentRound.deadlineAt': args.deadlineAt, updatedAt: nowIso() });
}
