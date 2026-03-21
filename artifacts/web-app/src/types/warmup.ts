export type GameMode = 'solo' | 'ranked' | 'friend';

export interface GameProps {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
}

export interface LeaderboardEntry {
  uid: string;
  username: string;
  score: number;
  achievedAt: string;
}

export type SessionState = 'waiting' | 'playing' | 'round_end' | 'complete';

export interface SessionPlayer {
  uid: string;
  username: string;
  roundScore: number | null;
  roundWins: number;
  isBot: boolean;
}

export interface RoundResult {
  round: number;
  p1Score: number;
  p2Score: number;
  winner: 'p1' | 'p2' | 'draw';
}

export interface GameSession {
  id: string;
  gameId: string;
  mode: 'ranked' | 'friend';
  state: SessionState;
  currentRound: number;
  player1: SessionPlayer;
  player2: SessionPlayer;
  rounds: RoundResult[];
  winner?: 'p1' | 'p2' | 'draw';
  createdAt: string;
}

export interface MatchmakingEntry {
  uid: string;
  username: string;
  gameId: string;
  joinedAt: string;
  sessionId: string | null;
}

export interface Challenge {
  id: string;
  fromUid: string;
  fromUsername: string;
  toUid: string;
  toUsername: string;
  gameId: string;
  gameLabel: string;
  state: 'pending' | 'accepted' | 'declined';
  sessionId?: string;
  createdAt: string;
}
