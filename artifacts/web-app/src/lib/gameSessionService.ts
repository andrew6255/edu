import { getGlobalDoc, setGlobalDoc, updateGlobalDoc, deleteGlobalDoc, queryGlobalDocs, setUserDoc, listenGlobalDoc, listenGlobalCollection } from '@/lib/supabaseDocStore';
import { requireSupabase } from '@/lib/supabase';
import { GameSession, Challenge, RoundResult, SessionPlayer } from '@/types/warmup';
import { createLogicGameFriendMatch } from '@/lib/logicGameFriendService';

const ROUNDS_TO_WIN = 3;
const TOTAL_ROUNDS = 5;

type MatchmakingEntry = {
  uid: string;
  username: string;
  gameId: string;
  joinedAt: string;
  sessionId: string | null;
};

function makeId() {
  return Math.random().toString(36).slice(2, 11);
}

export async function respondToLogicGameChallenge(
  challengeId: string,
  accept: boolean,
  respondentUid: string,
  respondentUsername: string
): Promise<{ matchId: string } | null> {
  if (!accept) {
    await updateGlobalDoc('challenges', challengeId, { state: 'declined' });
    return null;
  }

  const raw = await getGlobalDoc('challenges', challengeId);
  if (!raw) return null;
  const challenge = raw as any as Challenge;
  if (challenge.kind !== 'logicGame') return null;
  const nodeId = challenge.logicGameNodeId;
  if (!nodeId) throw new Error('Missing logicGameNodeId');

  const match = await createLogicGameFriendMatch({
    nodeId,
    host: { uid: challenge.fromUid, username: challenge.fromUsername },
    guest: { uid: respondentUid, username: respondentUsername },
  });

  await updateGlobalDoc('challenges', challengeId, {
    state: 'accepted',
    sessionId: match.id,
  });

  return { matchId: match.id };
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
  await setGlobalDoc('gameSessions', id, session as any);
  return session;
}

export async function submitRoundScore(
  sessionId: string,
  playerKey: 'player1' | 'player2',
  score: number
): Promise<void> {
  await updateGlobalDoc('gameSessions', sessionId, {
    [`${playerKey}.roundScore`]: score
  });
}

export async function resolveRound(sessionId: string): Promise<GameSession | null> {
  const raw = await getGlobalDoc('gameSessions', sessionId);
  if (!raw) return null;
  const session = raw as any as GameSession;

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

  await updateGlobalDoc('gameSessions', sessionId, update);
  const updated = await getGlobalDoc('gameSessions', sessionId);
  return updated as any as GameSession;
}

export function listenSession(
  sessionId: string,
  callback: (session: GameSession) => void
): () => void {
  // Initial fetch
  getGlobalDoc('gameSessions', sessionId).then(d => { if (d) callback(d as any as GameSession); }).catch(() => {});
  return listenGlobalDoc('gameSessions', sessionId, (data) => {
    callback(data as any as GameSession);
  });
}

export async function getSession(sessionId: string): Promise<GameSession | null> {
  const raw = await getGlobalDoc('gameSessions', sessionId);
  return raw ? (raw as any as GameSession) : null;
}

export async function forfeitSession(sessionId: string, forfeitingUid: string): Promise<void> {
  const raw = await getGlobalDoc('gameSessions', sessionId);
  if (!raw) return;
  const session = raw as any as GameSession;
  if (session.state === 'complete') return;

  const winner: 'p1' | 'p2' | 'draw' =
    session.player1.uid === forfeitingUid ? 'p2' : session.player2.uid === forfeitingUid ? 'p1' : 'draw';

  if (winner === 'draw') return;

  await updateGlobalDoc('gameSessions', sessionId, {
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
  await setGlobalDoc('matchmakingQueue', entryId, entry as any);

  const cutoff = new Date(Date.now() - 30000).toISOString();
  const rows = await queryGlobalDocs('matchmakingQueue', [{ field: 'gameId', op: 'eq', value: gameId }]);
  const others = rows
    .filter(r => r.id !== entryId && (r.data as any).sessionId === null && (r.data as any).joinedAt > cutoff)
    .sort((a, b) => ((a.data as any).joinedAt as string).localeCompare((b.data as any).joinedAt as string));

  if (others.length > 0) {
    const opponent = others[0].data as any as MatchmakingEntry;
    const p1: SessionPlayer = { uid: opponent.uid, username: opponent.username, roundScore: null, roundWins: 0, isBot: false };
    const p2: SessionPlayer = { uid, username, roundScore: null, roundWins: 0, isBot: false };
    const session = await createSession(gameId, 'ranked', p1, p2);

    await updateGlobalDoc('matchmakingQueue', others[0].id, { sessionId: session.id });
    await updateGlobalDoc('matchmakingQueue', entryId, { sessionId: session.id });

    return { matched: true, session, entryId };
  }

  return { matched: false, entryId };
}

export function listenMatchmakingEntry(
  entryId: string,
  callback: (sessionId: string) => void
): () => void {
  return listenGlobalDoc('matchmakingQueue', entryId, (data) => {
    if (data && data.sessionId) callback(data.sessionId as string);
  });
}

export async function cancelMatchmaking(entryId: string): Promise<void> {
  await deleteGlobalDoc('matchmakingQueue', entryId);
}

// ─── Friend Challenges ────────────────────────────────────────────────────────

export async function sendChallenge(
  fromUid: string,
  fromUsername: string,
  toUsername: string,
  gameId: string,
  gameLabel: string,
  opts?: { kind?: Challenge['kind']; logicGameNodeId?: string }
): Promise<{ success: boolean; challengeId?: string; error?: string }> {
  const trimmed = toUsername.trim();
  const normalized = trimmed.toLowerCase();

  try {
    // Look up username via Supabase profiles
    const supabase = requireSupabase();
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalized)
      .limit(1);

    let toUid: string | undefined = profileRows?.[0]?.id;
    if (!toUid && trimmed !== normalized) {
      const { data: rows2 } = await supabase.from('profiles').select('id').eq('username', trimmed).limit(1);
      toUid = rows2?.[0]?.id;
    }
    if (!toUid) return { success: false, error: 'Username not found' };
    if (toUid === fromUid) return { success: false, error: 'You cannot challenge yourself' };

    const challengeId = makeId();
    const challenge: Challenge = {
      id: challengeId,
      fromUid, fromUsername,
      toUid, toUsername: trimmed,
      gameId, gameLabel,
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.logicGameNodeId ? { logicGameNodeId: opts.logicGameNodeId } : {}),
      state: 'pending',
      createdAt: new Date().toISOString()
    };

    await setGlobalDoc('challenges', challengeId, challenge as any);

    const notifId = makeId();
    await setUserDoc(toUid, 'notifications', notifId, {
      id: notifId,
      fromUid,
      fromUsername,
      type: 'challenge',
      message: `${fromUsername} challenged you in ${gameLabel}.`,
      createdAt: new Date().toISOString(),
      read: false,
      resolved: false,
      challengeId,
      gameId,
      gameLabel,
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.logicGameNodeId ? { logicGameNodeId: opts.logicGameNodeId } : {}),
    });

    return { success: true, challengeId };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    const msg = err?.message || 'Failed to send challenge';
    const code = err?.code ? ` (${err.code})` : '';
    return { success: false, error: `${msg}${code}` };
  }
}

export function listenIncomingChallenges(
  uid: string,
  callback: (challenges: Challenge[]) => void
): () => void {
  return listenGlobalCollection(
    'challenges',
    [{ field: 'toUid', value: uid }, { field: 'state', value: 'pending' }],
    (docs) => {
      callback(docs.map(d => d.data as any as Challenge));
    }
  );
}

export function listenChallengeState(
  challengeId: string,
  callback: (challenge: Challenge) => void
): () => void {
  getGlobalDoc('challenges', challengeId).then(d => { if (d) callback(d as any as Challenge); }).catch(() => {});
  return listenGlobalDoc('challenges', challengeId, (data) => {
    callback(data as any as Challenge);
  });
}

export async function cancelChallenge(challengeId: string, fromUid: string): Promise<void> {
  const raw = await getGlobalDoc('challenges', challengeId);
  if (!raw) return;
  const challenge = raw as any as Challenge;
  if (challenge.fromUid !== fromUid) return;
  if (challenge.state !== 'pending') return;
  await updateGlobalDoc('challenges', challengeId, { state: 'canceled' });
}

export async function respondToChallenge(
  challengeId: string,
  accept: boolean,
  respondentUid: string,
  respondentUsername: string
): Promise<GameSession | null> {
  if (!accept) {
    await updateGlobalDoc('challenges', challengeId, { state: 'declined' });
    return null;
  }

  const raw = await getGlobalDoc('challenges', challengeId);
  if (!raw) return null;
  const challenge = raw as any as Challenge;

  const p1: SessionPlayer = { uid: challenge.fromUid, username: challenge.fromUsername, roundScore: null, roundWins: 0, isBot: false };
  const p2: SessionPlayer = { uid: respondentUid, username: respondentUsername, roundScore: null, roundWins: 0, isBot: false };
  const session = await createSession(challenge.gameId, 'friend', p1, p2);

  await updateGlobalDoc('challenges', challengeId, {
    state: 'accepted',
    sessionId: session.id
  });
  return session;
}

export async function cleanupSession(sessionId: string): Promise<void> {
  await deleteGlobalDoc('gameSessions', sessionId);
}

export async function sendQuickChat(
  sessionId: string,
  fromUid: string,
  fromUsername: string,
  text: string
): Promise<void> {
  await updateGlobalDoc('gameSessions', sessionId, {
    quickChat: {
      fromUid,
      fromUsername,
      text,
      createdAt: new Date().toISOString(),
    },
  });
}
