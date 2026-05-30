export type SymbolRecognitionInput = {
  imageBase64: string;
  allowedSymbols?: string[];
};

export type SymbolRecognitionResult = {
  provider: string;
  symbol: string | null;
  confidence: number | null;
  candidates: string[];
};
