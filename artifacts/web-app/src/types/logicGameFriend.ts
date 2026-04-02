export type LogicGameFriendMatchState = 'pending' | 'playing' | 'complete';

export type LogicGameFriendAttemptStatus = 'correct' | 'wrong' | 'timeout';

export type LogicGameFriendAttempt = {
  status: LogicGameFriendAttemptStatus;
  answeredAt: string;
};

export type LogicGameFriendRound = {
  roundIndex: number; // 0-based
  questionId: string;
  startedAt: string;
  deadlineAt: string;
  attempts: Record<string, LogicGameFriendAttempt>; // uid -> attempt
  winnerUid?: string | null;
};

export type LogicGameFriendMatch = {
  id: string;
  nodeId: string;
  state: LogicGameFriendMatchState;

  hostUid: string;
  hostUsername: string;
  guestUid: string;
  guestUsername: string;

  questionIds: string[];
  questionPtr: number;

  hostWins: number;
  guestWins: number;

  currentRound: LogicGameFriendRound;

  createdAt: string;
  updatedAt: string;
};
