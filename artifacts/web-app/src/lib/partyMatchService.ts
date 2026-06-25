import { setGlobalDoc, getGlobalDoc, updateGlobalDoc, listenGlobalDoc } from './supabaseDocStore';

export type PartyMatchState = 'playing' | 'round_end' | 'match_over';

export interface PartyPlayer {
  uid: string;
  username: string;
  emoji: string;
  score: number;
}

export interface PartyMatchDoc {
  id: string; // usually the lobbyId
  gameId: string;
  hostUid: string;
  players: PartyPlayer[];
  state: PartyMatchState;
  
  // Game-specific shared state
  sharedState: any;
  
  // Selections made by players for the current step (e.g. { uid: optionId })
  selections: Record<string, any>;
  
  // Array of previous rounds/results if needed
  history: any[];
  
  createdAt: string;
  updatedAt: string;
}

export async function createPartyMatch(args: {
  lobbyId: string;
  gameId: string;
  hostUid: string;
  players: PartyPlayer[];
}): Promise<void> {
  const match: PartyMatchDoc = {
    id: args.lobbyId,
    gameId: args.gameId,
    hostUid: args.hostUid,
    players: args.players.map(p => ({ ...p, score: 0 })),
    state: 'playing',
    sharedState: null, // Host will populate this
    selections: {},
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await setGlobalDoc('party_matches', match.id, match as any);
}

export async function getPartyMatch(matchId: string): Promise<PartyMatchDoc | null> {
  const doc = await getGlobalDoc('party_matches', matchId);
  return doc ? (doc as unknown as PartyMatchDoc) : null;
}

export function listenPartyMatch(matchId: string, cb: (doc: PartyMatchDoc) => void): () => void {
  // Initial fetch
  getPartyMatch(matchId).then(d => { if (d) cb(d); }).catch(() => {});
  return listenGlobalDoc('party_matches', matchId, data => cb(data as unknown as PartyMatchDoc));
}

export async function submitPartySelection(matchId: string, uid: string, selection: any): Promise<void> {
  const match = await getPartyMatch(matchId);
  if (!match) return;

  const newSelections = { ...match.selections, [uid]: selection };

  await updateGlobalDoc('party_matches', matchId, {
    selections: newSelections as any,
    updatedAt: new Date().toISOString(),
  });
}

export async function updatePartySharedState(matchId: string, hostUid: string, sharedState: any, resetSelections = true): Promise<void> {
  const match = await getPartyMatch(matchId);
  if (!match || match.hostUid !== hostUid) return;

  const updates: Record<string, any> = {
    sharedState,
    updatedAt: new Date().toISOString(),
  };
  
  if (resetSelections) {
    updates.selections = {};
  }

  await updateGlobalDoc('party_matches', matchId, updates);
}

export async function updatePartyMatchScore(matchId: string, hostUid: string, playerUid: string, scoreDelta: number): Promise<void> {
  const match = await getPartyMatch(matchId);
  if (!match || match.hostUid !== hostUid) return;

  const updatedPlayers = match.players.map(p => 
    p.uid === playerUid ? { ...p, score: p.score + scoreDelta } : p
  );

  await updateGlobalDoc('party_matches', matchId, {
    players: updatedPlayers as any,
    updatedAt: new Date().toISOString(),
  });
}
