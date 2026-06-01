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
  iqDeltaCorrect: number;
  iqDeltaWrong: number;
};

export type LogicGameQuestionsDoc = {
  nodeId: string;
  questions: LogicGameQuestion[];
  updatedAt: string;
  publishedAt?: string;
};

export type LogicGamesProgressDoc = {
  id: 'global';
  iq: number;
  // Highest unlocked milestone (e.g. 80, 90, 100). IQ cannot drop below this.
  floorIq: number;
  updatedAt: string;
};
