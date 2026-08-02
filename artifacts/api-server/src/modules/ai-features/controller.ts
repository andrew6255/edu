import type { Request, Response } from 'express';
import { completeAiFeature, AiFeatureProviderError } from './service';
import { parseAiFeatureRequest } from './validation';

const windows = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 40;

function consumeRateLimit(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = windows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  if (windows.size > 500) {
    for (const [entryKey, entry] of windows) {
      if (now - entry.startedAt >= WINDOW_MS) windows.delete(entryKey);
    }
  }
  return true;
}

export async function runAiFeature(req: Request, res: Response): Promise<void> {
  if (!consumeRateLimit(req)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Too many AI feature requests. Please wait a minute and try again.' });
    return;
  }
  try {
    res.json(await completeAiFeature(parseAiFeatureRequest(req.body)));
  } catch (error) {
    if (error instanceof AiFeatureProviderError) {
      if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
      const status = error.status === 429 ? 429 : error.status === 503 ? 503 : 502;
      res.status(status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid AI feature request.' });
  }
}
