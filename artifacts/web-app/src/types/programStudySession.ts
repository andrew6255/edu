export type ProgramStudySessionState = 'lobby' | 'playing' | 'complete';

export interface ProgramStudyParticipant {
  uid: string;
  username: string;
  lastActiveAt: string;
}

export interface ProgramStudyAnswer {
  choiceIndex: number;
  answeredAt: string;
}

export interface ProgramStudySession {
  id: string;
  code: string;
  state: ProgramStudySessionState;

  hostUid: string;

  programId: string;
  regionId: string;
  questionTypeId: string;

  questionIds: string[];
  currentIndex: number;
  reveal: boolean;

  participants: Record<string, ProgramStudyParticipant>;
  answers: Record<string, Record<string, ProgramStudyAnswer>>;

  createdAt: string;
  updatedAt: string;
}

export interface ProgramStudyMessage {
  id: string;
  fromUid: string;
  fromUsername: string;
  text: string;
  createdAt: string;
}
