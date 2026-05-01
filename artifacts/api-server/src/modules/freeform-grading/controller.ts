import type { Request, Response } from "express";
import { parseFreeformGradeInput } from "./validation";
import { freeformGradingService } from "./service";

export async function gradeFreeformAnswer(req: Request, res: Response): Promise<void> {
  try {
    const input = parseFreeformGradeInput(req.body);
    const result = await freeformGradingService.grade(input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}
