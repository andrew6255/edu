import type { ExtractedQuestionBlock } from "./types";

export interface NormalizationPromptPayload {
  system: string;
  user: string;
}

export function buildQuestionNormalizationPrompt(block: ExtractedQuestionBlock): NormalizationPromptPayload {
  return {
    system: [
      "You are a math question normalizer.",
      "Return strict JSON only.",
      "Never invent unreadable content.",
      "Choose the simplest valid question kind.",
      "Prefer deterministic grading when possible.",
      "Use open_response_ai only when deterministic or step-based grading is insufficient.",
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Normalize a single extracted question block into the app question schema.",
        allowedKinds: [
          "mcq_single",
          "mcq_multi",
          "true_false",
          "numeric_exact",
          "numeric_tolerance",
          "short_text",
          "expression_equivalence",
          "equation_input",
          "fill_blank",
          "ordered_steps",
          "multi_part",
          "open_response_ai",
        ],
        outputShape: {
          detectedKind: "one allowed kind",
          confidence: 0,
          isMultiPart: false,
          needsDiagram: false,
          autoGradable: true,
          recommendedGradingMode: "deterministic | step_based | ai_rubric",
          warnings: ["string"],
          normalizedQuestion: { id: block.id },
        },
        block,
      },
      null,
      2,
    ),
  };
}
