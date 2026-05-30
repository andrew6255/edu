import type { Request, Response } from 'express';
import { parseSymbolRecognitionInput } from './validation';
import { symbolRecognitionService } from './service';

export async function recognizeSymbol(req: Request, res: Response): Promise<void> {
  try {
    const input = parseSymbolRecognitionInput(req.body);
    const result = await symbolRecognitionService.recognize(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
}
