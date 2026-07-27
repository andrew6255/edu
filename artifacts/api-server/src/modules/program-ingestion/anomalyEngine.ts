/**
 * Anomaly Detection Engine for Program Ingestion
 * ──────────────────────────────────────────────
 * Evaluates extracted PDF question metadata and assigns audit flags
 * and Super-Admin review status.
 */

export interface QuestionAnomalyInput {
  correctChoiceIndex: number;
  hasAnswerMap: boolean;
  blocks: Array<{ type: string; [key: string]: unknown }>;
  choices: string[];
  hasQuestionImage?: boolean;
}

export interface QuestionAnomalyResult {
  reviewStatus: "VERIFIED" | "FLAGGED_FOR_REVIEW";
  flags: string[];
}

export function evaluateQuestionAnomalies(input: QuestionAnomalyInput): QuestionAnomalyResult {
  const flags: string[] = [];

  // Flag 1: Missing answer key mapping when answer key section was detected
  if (input.correctChoiceIndex === -1 && input.hasAnswerMap) {
    flags.push("MISSING_ANSWER_KEY");
  }

  // Flag 2: Question or choices contain visual diagrams requiring human verification
  if (
    input.hasQuestionImage ||
    input.blocks.some((b) => b.type === "image") ||
    input.choices.some((c) => typeof c === "string" && c.startsWith("data:image"))
  ) {
    flags.push("CONTAINS_DIAGRAM");
  }

  // Flag 3: Suspicious choice count (e.g., less than 2 options for MCQ)
  if (input.choices.length < 2) {
    flags.push("FEW_CHOICES");
  }

  const reviewStatus = flags.length > 0 ? "FLAGGED_FOR_REVIEW" : "VERIFIED";

  return {
    reviewStatus,
    flags,
  };
}
