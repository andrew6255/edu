import type { FreeformGradeDetails, FreeformGradeInput, FreeformGradeResult } from "./types";

export interface FreeformGradingProvider {
  name: string;
  grade(input: FreeformGradeInput): Promise<FreeformGradeResult>;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildFallbackFeedback(input: FreeformGradeInput): string {
  if (input.grading === "manual") {
    return "This answer needs teacher/manual review.";
  }
  return "AI review is not configured yet. This answer is queued for review.";
}

function buildFallbackDetails(input: FreeformGradeInput): FreeformGradeDetails {
  return {
    decision: input.grading === "manual" ? "Needs manual review" : "Pending AI review",
    strengths: [],
    issues: [],
    nextStep: input.grading === "manual"
      ? "Ask a teacher or reviewer to assess this explanation."
      : "Retry after AI grading is configured, or review the answer manually.",
    confidence: "low",
  };
}

function buildExactMatchDetails(): FreeformGradeDetails {
  return {
    decision: "Matches the reference answer exactly",
    strengths: ["The submitted answer matches the stored reference answer."],
    issues: [],
    nextStep: null,
    confidence: "high",
  };
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function parseGradeDetails(value: unknown, fallbackDecision: string): FreeformGradeDetails {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const confidence = raw["confidence"] === "high" || raw["confidence"] === "medium" ? raw["confidence"] : "low";
  return {
    decision: typeof raw["decision"] === "string" && raw["decision"].trim()
      ? raw["decision"].trim()
      : fallbackDecision,
    strengths: normalizeStringArray(raw["strengths"]),
    issues: normalizeStringArray(raw["issues"]),
    nextStep: typeof raw["nextStep"] === "string" && raw["nextStep"].trim() ? raw["nextStep"].trim() : null,
    confidence,
  };
}

function buildFeedbackFromDetails(details: FreeformGradeDetails): string {
  const parts: string[] = [details.decision];
  if (details.strengths.length > 0) parts.push(`Strengths: ${details.strengths.join("; ")}`);
  if (details.issues.length > 0) parts.push(`Issues: ${details.issues.join("; ")}`);
  if (details.nextStep) parts.push(`Next step: ${details.nextStep}`);
  return parts.filter(Boolean).join("\n");
}

export class PendingReviewFreeformGradingProvider implements FreeformGradingProvider {
  readonly name = "pending_review_fallback";

  async grade(input: FreeformGradeInput): Promise<FreeformGradeResult> {
    return {
      correct: false,
      correctIndex: 0,
      status: "pending_review",
      method: "fallback",
      feedbackText: buildFallbackFeedback(input),
      provider: this.name,
      details: buildFallbackDetails(input),
    };
  }
}

function extractCandidateAnswerText(input: FreeformGradeInput): string[] {
  const out = new Set<string>();
  if (input.solutionText) out.add(normalize(input.solutionText));
  if (input.rubricSummary) out.add(normalize(input.rubricSummary));
  return Array.from(out).filter(Boolean);
}

export class GeminiFreeformGradingProvider implements FreeformGradingProvider {
  readonly name = "gemini_freeform_grader";

  async grade(input: FreeformGradeInput): Promise<FreeformGradeResult> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required when FREEFORM_GRADING_PROVIDER=gemini.");
    }

    const expectedTexts = extractCandidateAnswerText(input);
    const normalizedAnswer = normalize(input.answerText);
    if (expectedTexts.some((candidate) => candidate && normalizedAnswer === candidate)) {
      return {
        correct: true,
        correctIndex: 0,
        status: "graded",
        method: "fallback",
        feedbackText: "Accepted by exact AI-context match.",
        provider: this.name,
        details: buildExactMatchDetails(),
      };
    }

    const model = process.env["FREEFORM_GRADING_GEMINI_MODEL"] ?? "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const prompt = [
      "You are grading a student freeform answer for a math-learning product.",
      "Be conservative and evidence-based.",
      "Return JSON only.",
      "Schema:",
      '{"correct":boolean,"status":"graded"|"pending_review","feedbackText":string,"details":{"decision":string,"strengths":string[],"issues":string[],"nextStep":string|null,"confidence":"low"|"medium"|"high"}}',
      "Use status=graded only when the answer is clearly acceptable from the provided context.",
      "If uncertain, incomplete, or ambiguous, return status=pending_review and correct=false.",
      `Question: ${input.questionText}`,
      `Answer: ${input.answerText}`,
      input.solutionText ? `Reference solution: ${input.solutionText}` : "",
      input.rubricSummary ? `Rubric: ${input.rubricSummary}` : "",
      Array.isArray(input.hints) && input.hints.length > 0 ? `Hints: ${input.hints.join(" | ")}` : "",
      input.stepValues && Object.keys(input.stepValues).length > 0 ? `Work shown: ${JSON.stringify(input.stepValues)}` : "",
    ].filter(Boolean).join("\n\n");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new PendingReviewFreeformGradingProvider().grade(input);
      }
      const errorText = await response.text();
      throw new Error(`Gemini freeform grading request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    if (!text) {
      return new PendingReviewFreeformGradingProvider().grade(input);
    }

    let parsed: { correct?: unknown; feedbackText?: unknown; status?: unknown; details?: unknown } | null = null;
    try {
      parsed = parseJsonResponse(text) as { correct?: unknown; feedbackText?: unknown; status?: unknown; details?: unknown };
    } catch {
      return new PendingReviewFreeformGradingProvider().grade(input);
    }

    const status = parsed?.status === "graded" ? "graded" : "pending_review";
    const correct = status === "graded" && parsed?.correct === true;
    const details = parseGradeDetails(parsed?.details, status === "graded" ? "Answer accepted" : "Needs review");
    const fallbackFeedback = buildFeedbackFromDetails(details) || buildFallbackFeedback(input);
    return {
      correct,
      correctIndex: 0,
      status,
      method: "fallback",
      feedbackText: typeof parsed?.feedbackText === "string" && parsed.feedbackText.trim() ? parsed.feedbackText.trim() : fallbackFeedback,
      provider: this.name,
      details,
    };
  }
}

export function getFreeformGradingProvider(): FreeformGradingProvider {
  const provider = (process.env["FREEFORM_GRADING_PROVIDER"] ?? "fallback").toLowerCase().trim();
  switch (provider) {
    case "":
    case "fallback":
    case "manual":
      return new PendingReviewFreeformGradingProvider();
    case "gemini":
      return new GeminiFreeformGradingProvider();
    default:
      throw new Error(`Unsupported FREEFORM_GRADING_PROVIDER value: ${provider}. Supported values are fallback, manual, gemini.`);
  }
}
