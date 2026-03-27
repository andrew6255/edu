export type ProgramFriendSessionState = 'waiting' | 'playing' | 'complete';

export interface ProgramFriendPlayer {
  uid: string;
  username: string;
}

export interface ProgramFriendAnswer {
  choiceIndex: number;
  correct: boolean;
  answeredAt: string;
}

export interface ProgramFriendSession {
  id: string;
  code: string;
  programId: string;
  regionId: string;
  questionTypeId: string;
  state: ProgramFriendSessionState;
  host: ProgramFriendPlayer;
  guest: ProgramFriendPlayer | null;
  questionIds: string[];
  currentIndex: number;
  createdAt: string;
  updatedAt: string;
  scores: Record<string, number>;
  answers: Record<string, Record<string, ProgramFriendAnswer>>;
}
