/**
 * A bucket. Authoring-only: it decides the starting difficulty of questions filed
 * into it and has no threshold, no unlock gate, and no student-facing meaning.
 * Questions self-calibrate from that seed as players answer them.
 */
export type LogicGameBucket = {
  id: string;
  label: string; // e.g. "Medium"
  seedDifficulty: number;
  order: number;
  /** @deprecated Old level threshold. Dropped once the level map is gone. */
  iq?: number;
  publishedAt?: string;
  updatedAt?: string;
};

/** @deprecated Buckets replaced levels; kept so existing imports keep compiling. */
export type LogicGameNode = LogicGameBucket;

/** A question as served by logic_game_next_question, with the answer key stripped. */
export type LogicGameServedQuestion = {
  nodeId: string;
  questionId: string;
  promptBlocks?: LogicGamePromptBlock[];
  promptRawText?: string;
  promptLatex?: string;
  timeLimitSec: number;
  interaction: LogicGameInteraction;
};

export type LogicGameSubmitResult = {
  alreadyAnswered: boolean;
  correct: boolean;
  mode: 'iq' | 'chill';
  iqBefore: number;
  iqAfter: number;
  delta: number;
  peakIq?: number;
};

export type LogicGamePromptBlock =
  | { type: 'text'; text: string }
  | { type: 'math'; latex: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'table'; rows: string[][]; headerRows?: number };

export type LogicGameInteraction =
  | { type: 'mcq'; choices: string[]; correctChoiceIndex: number }
  | { type: 'numeric'; correct: number | string | Array<number | string>; tolerance?: number }
  | { type: 'text'; accepted: string[]; trim?: boolean; caseSensitive?: boolean };

export type LogicGameQuestion = {
  id: string;
  /** Original paper number retained by the super-admin extraction workflow. */
  questionNumber?: string | number;
  promptBlocks?: LogicGamePromptBlock[];
  promptRawText?: string;
  promptLatex?: string;
  interaction: LogicGameInteraction;
  timeLimitSec: number;
  /** @deprecated Use time-based gain system instead */
  iqDeltaCorrect: number;
  /** @deprecated Use IQ-relative loss system instead */
  iqDeltaWrong: number;
  /** IQ level of this question */
  questionIq?: number;
  /** Maximum IQ gain when answered correctly (e.g. 2.0) */
  maxIqGain?: number;
  /** IQ gain lost per time interval (e.g. 0.1 means -0.1 per interval) */
  iqGainDecayRate?: number;
  /** Time interval in seconds for gain decay (e.g. 10) */
  iqGainDecayIntervalSec?: number;
  /** Base IQ loss for incorrect answer (positive number, e.g. 3) */
  iqLossBase?: number;
  /** Scale factor for extra loss when question IQ << student IQ (e.g. 0.05) */
  iqLossScaleFactor?: number;
  /** Explanation shown in chill mode after answering */
  explanation?: string;
  /** Broad category classification for the question */
  category?: 'Fluid Reasoning' | 'Quantitative Reasoning' | 'Verbal Reasoning' | 'Working Memory';
};

export type LogicGameQuestionsDoc = {
  nodeId: string;
  questions: LogicGameQuestion[];
  updatedAt: string;
  publishedAt?: string;
};

export type LogicGameNodeQueue = {
  currentQueue: string[];
  nextRoundWrong: string[];
  nextRoundRight: string[];
};

export type LogicGamesProgressDoc = {
  id: 'global';
  /** Live Elo rating. Falls as well as rises — that symmetry is what keeps it meaningful. */
  iq: number;
  /** Cosmetic "highest ever reached" badge. Never decreases. */
  peakIq: number;
  /** @deprecated Ratcheting floor from the level system. Dropped in the Elo cleanup. */
  floorIq?: number;
  nodeQueues?: Record<string, LogicGameNodeQueue>;
  updatedAt: string;
};
