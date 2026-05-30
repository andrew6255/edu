import type { FreeformGradeInput, FreeformGradeResult } from "./types";
import { getFreeformGradingProvider } from "./providers";

export class FreeformGradingService {
  async grade(input: FreeformGradeInput): Promise<FreeformGradeResult> {
    const provider = getFreeformGradingProvider();
    return provider.grade(input);
  }
}

export const freeformGradingService = new FreeformGradingService();
