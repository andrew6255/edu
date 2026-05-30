import type { Request, Response } from 'express';
import { aiTutorService } from './service';
import { parseTutorChatInput, parseTutorEvaluationInput } from './validation';

export async function evaluateWork(req: Request, res: Response): Promise<void> {
  try {
    const input = parseTutorEvaluationInput(req.body);
    const result = await aiTutorService.evaluateWork(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
}

export function getTutorStatus(_req: Request, res: Response): void {
  res.json(aiTutorService.getStatus());
}

export async function chatWithTutor(req: Request, res: Response): Promise<void> {
  try {
    const input = parseTutorChatInput(req.body);
    const result = await aiTutorService.chat(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
}
