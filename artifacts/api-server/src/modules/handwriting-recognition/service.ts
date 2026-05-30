import type { HandwritingRecognitionInput, HandwritingRecognitionResult } from './types';
import { getHandwritingRecognitionProvider } from './providers';

export class HandwritingRecognitionService {
  async recognize(input: HandwritingRecognitionInput): Promise<HandwritingRecognitionResult> {
    const provider = getHandwritingRecognitionProvider();
    return provider.recognize(input);
  }
}

export const handwritingRecognitionService = new HandwritingRecognitionService();
