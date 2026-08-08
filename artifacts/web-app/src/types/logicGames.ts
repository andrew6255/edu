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

/** The 7 Cognitive Metrics Framework. Every question can be tagged with one
 * primary metric (10pts on a correct ranked answer) and up to two secondary
 * metrics (5pts each); a student's per-metric totals form their "mental
 * profile", opened by tapping their IQ number. */
export type CognitiveMetric =
  | 'spatial_imagination'
  | 'fluid_patterning'
  | 'deductive_logic'
  | 'quantitative_abstraction'
  | 'working_memory'
  | 'strategic_optimization'
  | 'visual_perceptual_precision';

export const COGNITIVE_METRICS: Array<{ slug: CognitiveMetric; label: string; blurb: string }> = [
  { slug: 'spatial_imagination', label: 'Spatial Imagination', blurb: 'Visualizing, rotating, and folding shapes in 2D/3D.' },
  { slug: 'fluid_patterning', label: 'Fluid Patterning', blurb: 'Spotting rules and structure in non-verbal sequences.' },
  { slug: 'deductive_logic', label: 'Deductive Logic', blurb: 'Step-by-step conditional reasoning and elimination.' },
  { slug: 'quantitative_abstraction', label: 'Quantitative Abstraction', blurb: 'Ratios, scaling, and turning scenarios into equations.' },
  { slug: 'working_memory', label: 'Working Memory', blurb: 'Holding several variables or constraints in mind at once.' },
  { slug: 'strategic_optimization', label: 'Strategic Optimization', blurb: 'Worst-case reasoning, invariants, and lateral shortcuts.' },
  { slug: 'visual_perceptual_precision', label: 'Visual Perceptual Precision', blurb: 'Fast, accurate visual discrimination under noise.' },
];

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
  /** Short whole-question explanation, revealed only after answering. */
  explanation?: string;
  /** The unsanitized interaction (answer key + per-option explanations included),
   * revealed only after answering — safe at that point since the student has
   * already committed their answer. */
  interaction?: LogicGameInteraction;
  /** The student's updated mental profile, when this answer scored one. */
  mentalProfile?: Partial<Record<CognitiveMetric, number>>;
};

export type LogicGamePromptBlock =
  | { type: 'text'; text: string }
  | { type: 'math'; latex: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'table'; rows: string[][]; headerRows?: number };

export type LogicGameInteraction =
  | { type: 'mcq'; choices: string[]; correctChoiceIndex: number; choiceExplanations?: string[] }
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
  /** Short explanation shown after answering (used for non-MCQ, and as a fallback) */
  explanation?: string;
  /** Primary cognitive metric this question tests (10pts on a correct ranked answer) */
  primaryMetric?: CognitiveMetric;
  /** Up to 2 secondary cognitive metrics (5pts each on a correct ranked answer) */
  secondaryMetrics?: CognitiveMetric[];
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
  /** Running per-metric point totals from the 7 Cognitive Metrics Framework. */
  mentalProfile?: Partial<Record<CognitiveMetric, number>>;
  updatedAt: string;
};
