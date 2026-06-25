export type LogicGameNode = {
  id: string;
  iq: number;
  label: string; // e.g. "IQ 80"
  order: number;
  publishedAt?: string;
  updatedAt?: string;
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
  iq: number;
  // Highest unlocked milestone (e.g. 80, 90, 100). IQ cannot drop below this.
  floorIq: number;
  nodeQueues?: Record<string, LogicGameNodeQueue>;
  updatedAt: string;
};
