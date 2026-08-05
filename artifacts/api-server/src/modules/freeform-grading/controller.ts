import type { Request, Response } from "express";
import { parseFreeformGradeInput } from "./validation";
import { freeformGradingService } from "./service";
import { verifySupabaseToken } from "../../lib/supabaseServer";

const gradingWindows = new Map<string, { startedAt: number; count: number }>();

function consumeGradingRateLimit(userId: string): boolean {
  const now = Date.now();
  const current = gradingWindows.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    gradingWindows.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

export async function gradeFreeformAnswer(req: Request, res: Response): Promise<void> {
  try {
    const user = await verifySupabaseToken(req.header("authorization"));
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!consumeGradingRateLimit(user.id)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Too many grading requests. Please wait a minute." });
      return;
    }
    const input = parseFreeformGradeInput(req.body);
    const result = await freeformGradingService.grade(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}
