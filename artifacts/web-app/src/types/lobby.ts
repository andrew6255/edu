// ─── Lobby System Types ────────────────────────────────────────────────────────

export type LobbyGameModeKind = 'warmup' | 'iqGame' | 'program';

export interface LobbyGameMode {
  kind: LobbyGameModeKind;
  /** Human-readable label shown in the lobby */
  label: string;
  /** Game ID / IQ node ID / program ID */
  id: string;
  /** Extra display info (e.g. difficulty, level number) */
  subtitle?: string;
}

export interface LobbyPlayer {
  uid: string;
  username: string;
  /** Emoji chosen to represent this player */
  emoji: string;
  ready: boolean;
  isLeader: boolean;
}

export interface LobbyMessage {
  uid: string;
  username: string;
  text: string;
  sentAt: string;
}

export type LobbyState = 'waiting' | 'countdown' | 'inGame' | 'finished';

export interface LobbyDoc {
  id: string;
  leaderUid: string;
  players: LobbyPlayer[];
  gameMode: LobbyGameMode | null;
  state: LobbyState;
  countdownStartedAt: string | null;
  chat: LobbyMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface FriendPresence {
  uid: string;
  username: string;
  /** ISO timestamp of last activity */
  lastActive: string;
  /** True if lastActive is within 3 minutes */
  isOnline: boolean;
}
