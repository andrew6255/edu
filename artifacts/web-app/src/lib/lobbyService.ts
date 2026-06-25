/**
 * Lobby Service
 *
 * Real-time party/lobby system using the existing global_docs infrastructure.
 * Lobby documents are stored under collection 'lobbies' in global_docs.
 *
 * Max players: 5
 * Leadership transfers to next player when leader leaves.
 */

import {
  getGlobalDoc,
  setGlobalDoc,
  updateGlobalDoc,
  deleteGlobalDoc,
  listenGlobalDoc,
} from '@/lib/supabaseDocStore';
import { requireSupabase } from '@/lib/supabase';
import type { LobbyDoc, LobbyPlayer, LobbyGameMode, FriendPresence } from '@/types/lobby';

export const LOBBY_MAX_PLAYERS = 5;
/** A user is "online" if their last_active is within this many milliseconds */
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
/** Keep only the last N chat messages inline */
const MAX_CHAT_MESSAGES = 50;

// ─── Default Emoji ────────────────────────────────────────────────────────────

export const DEFAULT_EMOJI_LIST = [
  '😎', '🦊', '👻', '🐉', '🦁', '🐺', '🤖', '👾',
  '🐸', '🦄', '🐧', '🦋', '🐯', '🦝', '🐙', '🦖',
  '🧠', '🔥', '⚡', '🌊', '🎯', '🏆', '💎', '🚀',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(len = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getLobby(raw: unknown): LobbyDoc {
  return raw as LobbyDoc;
}

// ─── Lobby CRUD ───────────────────────────────────────────────────────────────

export async function createLobby(args: {
  uid: string;
  username: string;
  emoji: string;
}): Promise<LobbyDoc> {
  const lobbyId = makeId();
  const leader: LobbyPlayer = {
    uid: args.uid,
    username: args.username,
    emoji: args.emoji,
    ready: false,
    isLeader: true,
  };

  const doc: LobbyDoc = {
    id: lobbyId,
    leaderUid: args.uid,
    players: [leader],
    gameMode: null,
    state: 'waiting',
    countdownStartedAt: null,
    chat: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await setGlobalDoc('lobbies', lobbyId, doc as unknown as Record<string, unknown>);
  return doc;
}

export async function getLobbyDoc(lobbyId: string): Promise<LobbyDoc | null> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  return raw ? getLobby(raw) : null;
}

export async function joinLobby(args: {
  lobbyId: string;
  uid: string;
  username: string;
  emoji: string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = await getGlobalDoc('lobbies', args.lobbyId);
  if (!raw) return { success: false, error: 'Lobby not found' };
  const doc = getLobby(raw);

  if (doc.state !== 'waiting') return { success: false, error: 'Game already started' };
  if (doc.players.length >= LOBBY_MAX_PLAYERS) return { success: false, error: 'Lobby is full' };
  if (doc.players.some(p => p.uid === args.uid)) return { success: true }; // already in

  const newPlayer: LobbyPlayer = {
    uid: args.uid,
    username: args.username,
    emoji: args.emoji,
    ready: false,
    isLeader: false,
  };

  const updatedPlayers = [...doc.players, newPlayer];
  await updateGlobalDoc('lobbies', args.lobbyId, {
    players: updatedPlayers as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });

  return { success: true };
}

export async function leaveLobby(lobbyId: string, uid: string): Promise<void> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return;
  const doc = getLobby(raw);

  const remaining = doc.players.filter(p => p.uid !== uid);

  // No players left → delete the lobby
  if (remaining.length === 0) {
    await deleteGlobalDoc('lobbies', lobbyId);
    return;
  }

  // Transfer leadership if the leader left
  let updatedPlayers = remaining;
  const newLeaderUid = doc.leaderUid === uid ? remaining[0].uid : doc.leaderUid;
  updatedPlayers = remaining.map(p => ({
    ...p,
    isLeader: p.uid === newLeaderUid,
    // Reset ready status of all when leader changes
    ready: doc.leaderUid === uid ? false : p.ready,
  }));

  await updateGlobalDoc('lobbies', lobbyId, {
    players: updatedPlayers as unknown as Record<string, unknown>[],
    leaderUid: newLeaderUid,
    updatedAt: nowIso(),
  });
}

export async function kickPlayerFromLobby(lobbyId: string, leaderUid: string, targetUid: string): Promise<{success: boolean; error?: string}> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return { success: false, error: 'Lobby not found' };
  const doc = getLobby(raw);

  if (doc.leaderUid !== leaderUid) return { success: false, error: 'Only leader can kick' };
  
  const remaining = doc.players.filter(p => p.uid !== targetUid);
  
  await updateGlobalDoc('lobbies', lobbyId, {
    players: remaining as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });
  return { success: true };
}

export async function setLobbyLeader(
  lobbyId: string,
  currentLeaderUid: string,
  newLeaderUid: string
): Promise<{ success: boolean; error?: string }> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return { success: false, error: 'Lobby not found' };
  const doc = getLobby(raw);

  if (doc.leaderUid !== currentLeaderUid) return { success: false, error: 'Only leader can promote' };
  if (!doc.players.some(p => p.uid === newLeaderUid)) return { success: false, error: 'Player not in lobby' };

  const updatedPlayers = doc.players.map(p => ({
    ...p,
    isLeader: p.uid === newLeaderUid,
  }));

  await updateGlobalDoc('lobbies', lobbyId, {
    leaderUid: newLeaderUid,
    players: updatedPlayers as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });

  return { success: true };
}

export async function setPlayerReady(
  lobbyId: string,
  uid: string,
  ready: boolean
): Promise<void> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return;
  const doc = getLobby(raw);
  const updatedPlayers = doc.players.map(p =>
    p.uid === uid ? { ...p, ready } : p
  );

  const allReady = updatedPlayers.every(p => p.ready);
  const shouldStart = allReady && updatedPlayers.length >= 2 && doc.gameMode;

  const updates: Record<string, unknown> = {
    players: updatedPlayers as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  };

  if (shouldStart && doc.state === 'waiting') {
    updates.state = 'countdown';
    updates.countdownStartedAt = nowIso();
  } else if (!allReady && doc.state === 'countdown') {
    updates.state = 'waiting';
    updates.countdownStartedAt = null;
  }

  await updateGlobalDoc('lobbies', lobbyId, updates);
}

export async function setPlayerEmoji(
  lobbyId: string,
  uid: string,
  emoji: string
): Promise<void> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return;
  const doc = getLobby(raw);
  const updatedPlayers = doc.players.map(p =>
    p.uid === uid ? { ...p, emoji } : p
  );
  await updateGlobalDoc('lobbies', lobbyId, {
    players: updatedPlayers as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });
}

export async function setLobbyGameMode(
  lobbyId: string,
  leaderUid: string,
  gameMode: LobbyGameMode | null
): Promise<void> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return;
  const doc = getLobby(raw);
  if (doc.leaderUid !== leaderUid) return; // only leader can change

  // Reset all ready states when game mode changes
  const updatedPlayers = doc.players.map(p => ({ ...p, ready: false }));
  await updateGlobalDoc('lobbies', lobbyId, {
    gameMode: gameMode as unknown as Record<string, unknown> | null,
    players: updatedPlayers as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });
}


export async function setLobbyState(
  lobbyId: string,
  state: import('@/types/lobby').LobbyState
): Promise<void> {
  const raw = await getGlobalDoc('lobbies', lobbyId);
  if (!raw) return;
  const doc = getLobby(raw);

  let updatedPlayers = doc.players;
  if (state === 'waiting') {
    updatedPlayers = doc.players.map(p => ({ ...p, ready: false }));
  }

  await updateGlobalDoc('lobbies', lobbyId, {
    state,
    players: updatedPlayers as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });
}

// startLobbyGame removed because readying up automatically starts the countdown
// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function sendLobbyChat(args: {
  lobbyId: string;
  uid: string;
  username: string;
  text: string;
}): Promise<void> {
  const raw = await getGlobalDoc('lobbies', args.lobbyId);
  if (!raw) return;
  const doc = getLobby(raw);

  const newMsg = {
    uid: args.uid,
    username: args.username,
    text: args.text.slice(0, 300),
    sentAt: nowIso(),
  };

  const updatedChat = [...(doc.chat ?? []), newMsg].slice(-MAX_CHAT_MESSAGES);
  await updateGlobalDoc('lobbies', args.lobbyId, {
    chat: updatedChat as unknown as Record<string, unknown>[],
    updatedAt: nowIso(),
  });
}

// ─── Listener ─────────────────────────────────────────────────────────────────

export function listenLobby(
  lobbyId: string,
  cb: (doc: LobbyDoc) => void
): () => void {
  // Initial fetch
  getGlobalDoc('lobbies', lobbyId)
    .then(d => { if (d) cb(getLobby(d)); })
    .catch(() => {});

  return listenGlobalDoc('lobbies', lobbyId, data => cb(getLobby(data)));
}

// ─── Invite ───────────────────────────────────────────────────────────────────

export async function sendLobbyInvite(args: {
  fromUid: string;
  fromUsername: string;
  toUsername?: string;
  toTag?: string;
  toUid?: string;
  lobbyId: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = requireSupabase();
  let toUid = args.toUid;

  try {
    if (!toUid) {
      if (!args.toUsername || !args.toTag) return { success: false, error: 'Username and tag required' };
      const trimmed = args.toUsername.trim();
      const normalized = trimmed.toLowerCase();
      // Look up target user
      let { data: profileRows } = await supabase
        .from('profiles')
        .select('id, user_state')
        .eq('username', normalized);

      if (!profileRows || profileRows.length === 0) {
        const { data: rows2 } = await supabase.from('profiles').select('id, user_state').eq('username', trimmed);
        profileRows = rows2;
      }

      if (!profileRows || profileRows.length === 0) return { success: false, error: 'Username not found' };

      let targetRow = profileRows[0];
      const formattedTag = args.toTag.startsWith('#') ? args.toTag : `#${args.toTag}`;
      const match = profileRows.find((r: any) => r.user_state?.friendCode === formattedTag);
      if (match) {
        targetRow = match;
      } else {
        return { success: false, error: 'Username and tag combination not found' };
      }
      toUid = targetRow.id;
    }

    if (!toUid) return { success: false, error: 'Username not found' };
    if (toUid === args.fromUid) return { success: false, error: 'Cannot invite yourself' };

    // Write notification to target user's notification collection
    const notifId = makeId();
    const { setGlobalDoc: writeDoc } = await import('@/lib/supabaseDocStore');
    await writeDoc(`notifications:${toUid}`, notifId, {
      id: notifId,
      fromUid: args.fromUid,
      fromUsername: args.fromUsername,
      type: 'lobbyInvite',
      message: `${args.fromUsername} invited you to join their party!`,
      lobbyId: args.lobbyId,
      createdAt: nowIso(),
      read: false,
      resolved: false,
    });

    return { success: true };
  } catch (e) {
    const err = e as { message?: string };
    return { success: false, error: err?.message ?? 'Failed to send invite' };
  }
}

// ─── Friend Presence ──────────────────────────────────────────────────────────

export async function getFriendsPresence(
  friendUids: string[]
): Promise<FriendPresence[]> {
  if (friendUids.length === 0) return [];
  const supabase = requireSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('id, username, updated_at')
    .in('id', friendUids);

  const now = Date.now();
  return (data ?? []).map(row => {
    // Use updated_at as a proxy for last_active
    const lastActive = (row.updated_at as string) ?? '';
    const ms = lastActive ? now - new Date(lastActive).getTime() : Infinity;
    return {
      uid: row.id as string,
      username: (row.username as string) ?? '',
      lastActive,
      isOnline: ms < ONLINE_THRESHOLD_MS,
    };
  });
}

/** Touch the user's updated_at so presence shows as online */
export async function pingPresence(uid: string): Promise<void> {
  const supabase = requireSupabase();
  await supabase
    .from('profiles')
    .update({ updated_at: nowIso() })
    .eq('id', uid);
}
// ─── User Presence Doc (tracks current lobbyId) ───────────────────────────────

export async function setUserLobby(uid: string, lobbyId: string | null): Promise<void> {
  await setGlobalDoc('userPresence', uid, {
    uid,
    lobbyId,
    updatedAt: new Date().toISOString(),
  });
}

export async function getUserLobbyId(uid: string): Promise<string | null> {
  const raw = await getGlobalDoc('userPresence', uid);
  return (raw?.lobbyId as string | null) ?? null;
}

export async function getFriendsWithPresence(
  friendUids: string[],
  thresholdMs: number = 3 * 60 * 1000
): Promise<(import('@/types/lobby').FriendPresence & { lobbyId: string | null; lobbyPlayerCount: number })[]> {
  if (friendUids.length === 0) return [];
  const supabase = requireSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('id, username, updated_at')
    .in('id', friendUids);

  const now = Date.now();
  const profileMap = new Map((data ?? []).map((row: Record<string, unknown>) => [row.id as string, row]));

  const presences = await Promise.all(
    friendUids.map(async uid => {
      const row = profileMap.get(uid);
      const lastActive = (row?.updated_at as string) ?? '';
      const ms = lastActive ? now - new Date(lastActive).getTime() : Infinity;
      let lobbyId: string | null = null;
      let lobbyPlayerCount = 1;
      try { 
        lobbyId = await getUserLobbyId(uid); 
        if (lobbyId) {
          const lobbyDoc = await getLobbyDoc(lobbyId);
          if (lobbyDoc) lobbyPlayerCount = lobbyDoc.players.length;
        }
      } catch { /* ignore */ }
      return {
        uid,
        username: (row?.username as string) ?? uid,
        lastActive,
        isOnline: ms < thresholdMs,
        lobbyId,
        lobbyPlayerCount,
      };
    })
  );
  return presences;
}

// ─── Join Request ─────────────────────────────────────────────────────────────

export async function sendJoinRequest(args: {
  fromUid: string;
  fromUsername: string;
  fromEmoji: string;
  leaderUid: string;
  lobbyId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let notifId = '';
    for (let i = 0; i < 10; i++) notifId += chars[Math.floor(Math.random() * chars.length)];
    await setGlobalDoc('notifications:' + args.leaderUid, notifId, {
      id: notifId,
      fromUid: args.fromUid,
      fromUsername: args.fromUsername,
      fromEmoji: args.fromEmoji,
      type: 'lobbyJoinRequest',
      message: args.fromUsername + ' wants to join your party!',
      lobbyId: args.lobbyId,
      createdAt: new Date().toISOString(),
      read: false,
      resolved: false,
    });
    return { success: true };
  } catch (e) {
    const err = e as { message?: string };
    return { success: false, error: err?.message ?? 'Failed to send join request' };
  }
}

export async function acceptJoinRequest(args: {
  leaderUid: string;
  lobbyId: string;
  requesterUid: string;
  requesterUsername: string;
  requesterEmoji: string;
}): Promise<{ success: boolean; error?: string }> {
  const result = await joinLobby({
    lobbyId: args.lobbyId,
    uid: args.requesterUid,
    username: args.requesterUsername,
    emoji: args.requesterEmoji || '😎',
  });
  if (!result.success) return result;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let notifId = '';
  for (let i = 0; i < 10; i++) notifId += chars[Math.floor(Math.random() * chars.length)];
  await setGlobalDoc('notifications:' + args.requesterUid, notifId, {
    id: notifId,
    fromUid: args.leaderUid,
    fromUsername: '',
    type: 'lobbyInvite',
    message: 'Your join request was accepted! Click to join the party.',
    lobbyId: args.lobbyId,
    createdAt: new Date().toISOString(),
    read: false,
    resolved: false,
  });
  await setUserLobby(args.requesterUid, args.lobbyId);
  return { success: true };
}
