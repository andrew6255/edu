export type FreeformGradingMode = "ai" | "manual";

export type FreeformGradeDetails = {
  decision: string;
  strengths: string[];
  issues: string[];
  nextStep: string | null;
  confidence: "low" | "medium" | "high";
};

export type FreeformGradeInput = {
  questionText: string;
  answerText: string;
  grading: FreeformGradingMode;
  rubricSummary?: string | null;
  solutionText?: string | null;
  hints?: string[];
  stepValues?: Record<string, string> | null;
};

export type FreeformGradeResult = {
  correct: boolean;
  correctIndex: number;
  status: "graded" | "pending_review";
  method: "fallback";
  feedbackText: string | null;
  provider: string;
  details?: FreeformGradeDetails | null;
};
