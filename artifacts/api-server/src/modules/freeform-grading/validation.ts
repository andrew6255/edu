import type { FreeformGradeInput, FreeformGradingMode } from "./types";

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("Expected string value.");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array of strings.`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`${fieldName} must be an array of strings.`);
    return item.trim();
  }).filter((item) => item.length > 0);
}

function asOptionalStepValues(value: unknown): Record<string, string> | null | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stepValues must be an object map.");
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function parseFreeformGradeInput(body: unknown): FreeformGradeInput {
  const input = (body ?? {}) as Record<string, unknown>;
  const gradingRaw = typeof input["grading"] === "string" ? input["grading"].trim().toLowerCase() : "";
  const grading: FreeformGradingMode = gradingRaw === "manual" ? "manual" : "ai";
  return {
    questionText: asNonEmptyString(input["questionText"], "questionText"),
    answerText: asNonEmptyString(input["answerText"], "answerText"),
    grading,
    rubricSummary: asOptionalString(input["rubricSummary"]),
    solutionText: asOptionalString(input["solutionText"]),
    hints: asOptionalStringArray(input["hints"], "hints"),
    stepValues: asOptionalStepValues(input["stepValues"]) ?? null,
  };
}
