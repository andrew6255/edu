import type { AiQuestionAnalysis, ExtractedQuestionBlock, Question } from "./types";

function looksLikeMcq(text: string): boolean {
  return /\b[A-D][).]\s+/m.test(text);
}

function looksLikeTrueFalse(text: string): boolean {
  return /\btrue\b|\bfalse\b/i.test(text);
}

export function normalizeQuestionBlock(block: ExtractedQuestionBlock): AiQuestionAnalysis {
  const raw = block.rawText.trim();
  const warnings = [...(block.notes ?? [])];

  let detectedKind: AiQuestionAnalysis["detectedKind"] = "open_response_ai";
  let recommendedGradingMode: AiQuestionAnalysis["recommendedGradingMode"] = "ai_rubric";

  if (looksLikeMcq(raw)) {
    detectedKind = "mcq_single";
    recommendedGradingMode = "deterministic";
    warnings.push("MCQ options detected, but option parsing/answer-key extraction is not implemented yet.");
  } else if (looksLikeTrueFalse(raw)) {
    detectedKind = "true_false";
    recommendedGradingMode = "deterministic";
    warnings.push("True/False wording detected, but answer-key extraction is not implemented yet.");
  }

  const normalizedQuestion: Question = detectedKind === "open_response_ai"
    ? {
        id: block.id,
        kind: "open_response_ai",
        source: {
          page: block.page,
          questionLabel: block.questionLabel,
          regionIds: block.regionIds,
          extractedFromScan: (block.scanConfidence ?? 1) < 0.7,
          confidence: block.splitConfidence ?? 0.5,
          unreadableParts: [],
        },
        prompt: [{ type: "text", text: raw }],
        review: {
          status: "needs_review",
          flags: [],
        },
        grading: {
          mode: "ai_rubric",
          answerFormat: "open_text",
          rubricVersion: "v1-draft",
        },
        rubric: {
          modelAnswer: "",
          scoringCriteria: [],
          maxPoints: 0,
        },
      }
    : {
        id: block.id,
        kind: detectedKind,
        source: {
          page: block.page,
          questionLabel: block.questionLabel,
          regionIds: block.regionIds,
          extractedFromScan: (block.scanConfidence ?? 1) < 0.7,
          confidence: block.splitConfidence ?? 0.5,
          unreadableParts: [],
        },
        prompt: [{ type: "text", text: raw }],
        review: {
          status: "needs_review",
          flags: [],
        },
        grading: {
          mode: "deterministic",
          answerFormat: detectedKind === "true_false" ? "choice" : "choice",
        },
      };

  return {
    detectedKind,
    confidence: block.splitConfidence ?? 0.5,
    isMultiPart: /\([a-zA-Z]\)/.test(raw),
    needsDiagram: false,
    autoGradable: detectedKind !== "open_response_ai",
    recommendedGradingMode,
    warnings,
    normalizedQuestion,
  };
}
