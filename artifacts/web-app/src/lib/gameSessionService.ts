import { getGlobalDoc, setGlobalDoc, updateGlobalDoc, listenGlobalDoc, listenGlobalCollection } from '@/lib/supabaseDocStore';
import { requireSupabase } from '@/lib/supabase';
import { GameSession, Challenge } from '@/types/warmup';
import { createLogicGameFriendMatch } from '@/lib/logicGameFriendService';

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

export async function submitRoundScore(
  sessionId: string,
  round: number,
  score: number
): Promise<GameSession> {
  const { submitMultiplayerScore } = await import('@/lib/economyApiService');
  return await submitMultiplayerScore(sessionId, round, score) as unknown as GameSession;
}

export async function resolveRound(sessionId: string, round: number): Promise<GameSession> {
  const { resolveMultiplayerRound } = await import('@/lib/economyApiService');
  return await resolveMultiplayerRound(sessionId, round) as unknown as GameSession;
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

export async function forfeitSession(sessionId: string, _forfeitingUid?: string): Promise<GameSession> {
  const { forfeitMultiplayerSession } = await import('@/lib/economyApiService');
  return await forfeitMultiplayerSession(sessionId) as unknown as GameSession;
}

export function listenMatchmakingEntry(
  entryId: string,
  callback: (sessionId: string) => void
): () => void {
  return listenGlobalDoc('matchmakingQueue', entryId, (data) => {
    if (data && data.sessionId) callback(data.sessionId as string);
  });
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
  if (opts?.kind !== 'logicGame') {
    try {
      const { sendMultiplayerChallenge } = await import('@/lib/economyApiService');
      return await sendMultiplayerChallenge(toUsername, gameId, gameLabel);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to send challenge' };
    }
  }

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
    await setGlobalDoc(`notifications:${toUid}`, notifId, {
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
  if (challenge.kind !== 'logicGame') {
    const { cancelMultiplayerChallenge } = await import('@/lib/economyApiService');
    await cancelMultiplayerChallenge(challengeId);
    return;
  }
  await updateGlobalDoc('challenges', challengeId, { state: 'canceled' });
}

export async function respondToChallenge(
  challengeId: string,
  accept: boolean,
  respondentUid: string,
  respondentUsername: string
): Promise<GameSession | null> {
  if (!accept) {
    const { declineMultiplayerChallenge } = await import('@/lib/economyApiService');
    await declineMultiplayerChallenge(challengeId);
    return null;
  }

  void respondentUid;
  void respondentUsername;
  const { acceptMultiplayerChallenge } = await import('@/lib/economyApiService');
  return await acceptMultiplayerChallenge(challengeId) as unknown as GameSession;
}

export async function sendQuickChat(
  sessionId: string,
  text: string
): Promise<GameSession> {
  const { sendMultiplayerQuickChat } = await import('@/lib/economyApiService');
  return await sendMultiplayerQuickChat(sessionId, text) as unknown as GameSession;
}
