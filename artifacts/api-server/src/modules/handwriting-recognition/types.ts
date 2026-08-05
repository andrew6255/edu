export type HandwritingRecognitionInput = {
  imageBase64: string;
  preferredOutput?: 'text' | 'latex';
  contextHint?: string | null;
};

export type HandwritingRecognitionResult = {
  provider: string;
  text: string | null;
  latex: string | null;
  confidence: number | null;
  candidates: string[];
};

export type MyScriptInkStroke = {
  x: number[];
  y: number[];
  t: number[];
};

export type MyScriptInkInput = {
  width: number;
  height: number;
  strokes: MyScriptInkStroke[];
};

export type MyScriptInkResult = {
  jiix: unknown;
  latex: string;
};
