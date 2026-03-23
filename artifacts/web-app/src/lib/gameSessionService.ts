import { db } from './firebase';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, writeBatch,
  onSnapshot, Unsubscribe
} from 'firebase/firestore';
import {
  GameSession, SessionPlayer, RoundResult,
  MatchmakingEntry, Challenge
} from '@/types/warmup';

const ROUNDS_TO_WIN = 3;
const TOTAL_ROUNDS = 5;

function makeId() {
  return Math.random().toString(36).slice(2, 11);
}

function botPlayer(difficulty: 'easy' | 'medium' | 'hard' = 'medium'): SessionPlayer {
  return {
    uid: `logicbot_${difficulty}`,
    username: difficulty === 'easy' ? '🤖 Circuit Bot' : difficulty === 'medium' ? '🤖 LogicBot' : '👑 Logic Lord',
    roundScore: null,
    roundWins: 0,
    isBot: true
  };
}

export function generateBotScore(gameId: string, difficulty: 'easy' | 'medium' | 'hard'): number {
  const baseId = gameId.replace(/_(10s|60s)$/i, '');
  const ranges: Record<string, Record<string, [number, number]>> = {
    quickMath:    { easy: [3, 7],   medium: [6, 12],  hard: [10, 18] },
    advQuickMath: { easy: [2, 5],   medium: [4, 9],   hard: [7, 14]  },
    compareExp:   { easy: [4, 8],   medium: [7, 13],  hard: [10, 18] },
    trueFalse:    { easy: [5, 10],  medium: [8, 15],  hard: [12, 20] },
    missingOp:    { easy: [4, 8],   medium: [7, 12],  hard: [10, 16] },
    completeEq:   { easy: [3, 7],   medium: [5, 11],  hard: [8, 15]  },
    sequence:     { easy: [2, 5],   medium: [4, 8],   hard: [6, 12]  },
    pyramid:      { easy: [2, 4],   medium: [3, 7],   hard: [5, 10]  },
    memoCells:    { easy: [2, 4],   medium: [3, 6],   hard: [5, 8]   },
    memoOrder:    { easy: [2, 4],   medium: [3, 6],   hard: [5, 8]   },
    blockPuzzle:  { easy: [100, 300], medium: [200, 600], hard: [400, 1000] },
    fifteenPuzzle:{ easy: [60, 120], medium: [30, 70],  hard: [15, 40]  },
    neonGrid:     { easy: [2, 5],   medium: [4, 9],    hard: [7, 14]   },
    flipCup:      { easy: [2, 4],   medium: [3, 7],    hard: [5, 10]   },
    ticTacToe:    { easy: [0, 2],   medium: [1, 3],    hard: [2, 5]    },
    chessMemory:  { easy: [3, 8],   medium: [7, 14],   hard: [12, 20]  },
  };
  const range = ranges[baseId]?.[difficulty] ?? [3, 8];
  return Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
}

export async function createSession(
  gameId: string,
  mode: 'ranked' | 'friend',
  p1: SessionPlayer,
  p2: SessionPlayer
): Promise<GameSession> {
  const id = makeId();
  const session: GameSession = {
    id,
    gameId,
    mode,
    state: 'playing',
    currentRound: 1,
    player1: p1,
    player2: p2,
    rounds: [],
    createdAt: new Date().toISOString()
  };
  await setDoc(doc(db, 'gameSessions', id), session);
  return session;
}

export async function submitRoundScore(
  sessionId: string,
  playerKey: 'player1' | 'player2',
  score: number
): Promise<void> {
  await updateDoc(doc(db, 'gameSessions', sessionId), {
    [`${playerKey}.roundScore`]: score
  });
}

export async function resolveRound(sessionId: string): Promise<GameSession | null> {
  const snap = await getDoc(doc(db, 'gameSessions', sessionId));
  if (!snap.exists()) return null;
  const session = snap.data() as GameSession;

  const p1Score = session.player1.roundScore ?? 0;
  const p2Score = session.player2.roundScore ?? 0;
  const roundWinner: 'p1' | 'p2' | 'draw' =
    p1Score > p2Score ? 'p1' : p2Score > p1Score ? 'p2' : 'draw';

  const newRound: RoundResult = {
    round: session.currentRound,
    p1Score,
    p2Score,
    winner: roundWinner
  };

  const p1Wins = session.player1.roundWins + (roundWinner === 'p1' ? 1 : 0);
  const p2Wins = session.player2.roundWins + (roundWinner === 'p2' ? 1 : 0);

  const matchOver = p1Wins >= ROUNDS_TO_WIN || p2Wins >= ROUNDS_TO_WIN ||
    session.rounds.length + 1 >= TOTAL_ROUNDS;

  const matchWinner = p1Wins > p2Wins ? 'p1' : p2Wins > p1Wins ? 'p2' : 'draw';

  const update: Partial<GameSession> & Record<string, unknown> = {
    rounds: [...session.rounds, newRound],
    'player1.roundWins': p1Wins,
    'player2.roundWins': p2Wins,
    'player1.roundScore': null,
    'player2.roundScore': null,
    state: matchOver ? 'complete' : 'round_end',
    currentRound: session.currentRound + 1,
    ...(matchOver ? { winner: matchWinner } : {})
  };

  await updateDoc(doc(db, 'gameSessions', sessionId), update);
  const updated = await getDoc(doc(db, 'gameSessions', sessionId));
  return updated.data() as GameSession;
}

export function listenSession(
  sessionId: string,
  callback: (session: GameSession) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'gameSessions', sessionId), snap => {
    if (snap.exists()) callback(snap.data() as GameSession);
  });
}

export async function getSession(sessionId: string): Promise<GameSession | null> {
  const snap = await getDoc(doc(db, 'gameSessions', sessionId));
  return snap.exists() ? (snap.data() as GameSession) : null;
}

export async function forfeitSession(sessionId: string, forfeitingUid: string): Promise<void> {
  const snap = await getDoc(doc(db, 'gameSessions', sessionId));
  if (!snap.exists()) return;
  const session = snap.data() as GameSession;
  if (session.state === 'complete') return;

  const winner: 'p1' | 'p2' | 'draw' =
    session.player1.uid === forfeitingUid ? 'p2' : session.player2.uid === forfeitingUid ? 'p1' : 'draw';

  if (winner === 'draw') return;

  await updateDoc(doc(db, 'gameSessions', sessionId), {
    state: 'complete',
    winner,
  });
}

// ─── Matchmaking ─────────────────────────────────────────────────────────────

export async function joinMatchmaking(
  uid: string,
  username: string,
  gameId: string
): Promise<{ matched: boolean; session?: GameSession; entryId: string }> {
  const entryId = `${gameId}_${uid}`;
  const entry: MatchmakingEntry = {
    uid, username, gameId,
    joinedAt: new Date().toISOString(),
    sessionId: null
  };
  await setDoc(doc(db, 'matchmakingQueue', entryId), entry);

  const cutoff = new Date(Date.now() - 30000).toISOString();
  const q = query(
    collection(db, 'matchmakingQueue'),
    where('gameId', '==', gameId),
    where('sessionId', '==', null)
  );
  const results = await getDocs(q);
  const others = results.docs
    .filter(d => d.id !== entryId && d.data().joinedAt > cutoff)
    .sort((a, b) => a.data().joinedAt.localeCompare(b.data().joinedAt));

  if (others.length > 0) {
    const opponent = others[0].data() as MatchmakingEntry;
    const p1: SessionPlayer = { uid: opponent.uid, username: opponent.username, roundScore: null, roundWins: 0, isBot: false };
    const p2: SessionPlayer = { uid, username, roundScore: null, roundWins: 0, isBot: false };
    const session = await createSession(gameId, 'ranked', p1, p2);

    const batch = writeBatch(db);
    batch.update(doc(db, 'matchmakingQueue', others[0].id), { sessionId: session.id });
    batch.update(doc(db, 'matchmakingQueue', entryId), { sessionId: session.id });
    await batch.commit();

    return { matched: true, session, entryId };
  }

  return { matched: false, entryId };
}

export function listenMatchmakingEntry(
  entryId: string,
  callback: (sessionId: string) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'matchmakingQueue', entryId), snap => {
    if (snap.exists() && snap.data().sessionId) {
      callback(snap.data().sessionId as string);
    }
  });
}

export async function cancelMatchmaking(entryId: string): Promise<void> {
  await deleteDoc(doc(db, 'matchmakingQueue', entryId));
}

// ─── Friend Challenges ────────────────────────────────────────────────────────

export async function sendChallenge(
  fromUid: string,
  fromUsername: string,
  toUsername: string,
  gameId: string,
  gameLabel: string
): Promise<{ success: boolean; challengeId?: string; error?: string }> {
  const usersQ = query(
    collection(db, 'users'),
    where('username', '==', toUsername)
  );
  const results = await getDocs(usersQ);
  if (results.empty) return { success: false, error: 'Username not found' };

  const toDoc = results.docs[0];
  const toUid = toDoc.id;
  if (toUid === fromUid) return { success: false, error: 'You cannot challenge yourself' };

  const challengeId = makeId();
  const challenge: Challenge = {
    id: challengeId,
    fromUid, fromUsername,
    toUid, toUsername,
    gameId, gameLabel,
    state: 'pending',
    createdAt: new Date().toISOString()
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'challenges', challengeId), challenge);

  const notifRef = doc(collection(db, `users/${toUid}/notifications`));
  batch.set(notifRef, {
    id: notifRef.id,
    fromUid,
    fromUsername,
    type: 'challenge',
    message: `${fromUsername} challenged you in ${gameLabel}.`,
    createdAt: new Date().toISOString(),
    read: false,
    challengeId,
    gameId,
    gameLabel,
  });

  await batch.commit();
  return { success: true, challengeId };
}

export function listenIncomingChallenges(
  uid: string,
  callback: (challenges: Challenge[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'challenges'),
    where('toUid', '==', uid),
    where('state', '==', 'pending')
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => d.data() as Challenge));
  });
}

export function listenChallengeState(
  challengeId: string,
  callback: (challenge: Challenge) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'challenges', challengeId), snap => {
    if (snap.exists()) callback(snap.data() as Challenge);
  });
}

export async function respondToChallenge(
  challengeId: string,
  accept: boolean,
  respondentUid: string,
  respondentUsername: string
): Promise<GameSession | null> {
  if (!accept) {
    await updateDoc(doc(db, 'challenges', challengeId), { state: 'declined' });
    return null;
  }

  const snap = await getDoc(doc(db, 'challenges', challengeId));
  if (!snap.exists()) return null;
  const challenge = snap.data() as Challenge;

  const p1: SessionPlayer = { uid: challenge.fromUid, username: challenge.fromUsername, roundScore: null, roundWins: 0, isBot: false };
  const p2: SessionPlayer = { uid: respondentUid, username: respondentUsername, roundScore: null, roundWins: 0, isBot: false };
  const session = await createSession(challenge.gameId, 'friend', p1, p2);

  await updateDoc(doc(db, 'challenges', challengeId), {
    state: 'accepted',
    sessionId: session.id
  });
  return session;
}

export async function cleanupSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, 'gameSessions', sessionId));
}
