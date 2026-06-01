export type ProgramFriendSessionState = 'waiting' | 'playing' | 'complete';

export interface ProgramFriendPlayer {
  uid: string;
  username: string;
}

export interface ProgramFriendAnswer {
  // Backward-compatible MCQ fields
  choiceIndex?: number;

  // New: answer kind
  kind?: 'mcq' | 'numeric' | 'text';

  // New: freeform value (numeric/text)
  valueText?: string;

  // Optional local step work submitted alongside final answer
  stepValues?: Record<string, string>;

  // Whether the answer is correct (computed client-side for now)
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
