import type { SymbolRecognitionInput, SymbolRecognitionResult } from './types';
import { getSymbolRecognitionProvider } from './providers';

export class SymbolRecognitionService {
  async recognize(input: SymbolRecognitionInput): Promise<SymbolRecognitionResult> {
    const provider = getSymbolRecognitionProvider();
    return provider.recognize(input);
  }
}

export const symbolRecognitionService = new SymbolRecognitionService();
