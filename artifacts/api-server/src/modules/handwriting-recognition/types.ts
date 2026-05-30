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
