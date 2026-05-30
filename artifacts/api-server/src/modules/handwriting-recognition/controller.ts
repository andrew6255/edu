import type { Request, Response } from 'express';
import { parseHandwritingRecognitionInput } from './validation';
import { handwritingRecognitionService } from './service';

export async function recognizeHandwriting(req: Request, res: Response): Promise<void> {
  try {
    const input = parseHandwritingRecognitionInput(req.body);
    const result = await handwritingRecognitionService.recognize(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
}
