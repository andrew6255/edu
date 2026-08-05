import type { Request, Response } from 'express';
import { parseHandwritingRecognitionInput, parseMyScriptInkInput } from './validation';
import { handwritingRecognitionService } from './service';
import { recognizeMyScriptInk } from './providers';
import { verifySupabaseToken } from '../../lib/supabaseServer';

const recognitionWindows = new Map<string, { startedAt: number; count: number }>();
const RECOGNITION_WINDOW_MS = 60_000;
const MAX_RECOGNITIONS_PER_WINDOW = 30;

function consumeRecognitionLimit(userId: string): boolean {
  const now = Date.now();
  const current = recognitionWindows.get(userId);
  if (!current || now - current.startedAt >= RECOGNITION_WINDOW_MS) {
    recognitionWindows.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_RECOGNITIONS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

async function requireRecognitionUser(req: Request, res: Response): Promise<string | null> {
  const user = await verifySupabaseToken(req.header('authorization'));
  if (!user) { res.status(401).json({ error: 'Authentication required.' }); return null; }
  if (!consumeRecognitionLimit(user.id)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Too many handwriting requests. Please wait a minute and try again.' });
    return null;
  }
  return user.id;
}

export async function recognizeHandwriting(req: Request, res: Response): Promise<void> {
  try {
    if (!await requireRecognitionUser(req, res)) return;
    const input = parseHandwritingRecognitionInput(req.body);
    const result = await handwritingRecognitionService.recognize(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
}

export async function recognizeMyScriptHandwriting(req: Request, res: Response): Promise<void> {
  try {
    if (!await requireRecognitionUser(req, res)) return;
    const result = await recognizeMyScriptInk(parseMyScriptInkInput(req.body));
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Handwriting recognition failed.';
    const status = message.includes('not configured') ? 503 : 400;
    res.status(status).json({ error: message });
  }
}
