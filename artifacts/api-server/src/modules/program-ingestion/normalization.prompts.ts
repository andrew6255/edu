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
      "For line equations, coordinates, lists of points, and points constrained by a line, prefer structured deterministic answer types over generic text whenever the answer can be recovered.",
      "Use open_response_ai only when deterministic or step-based grading is insufficient.",
      "Every normalized question must include answerData with a final answer, a concise solution, and optional worked steps/explanation scenes.",
      "If the source is unreadable or the answer cannot be recovered reliably, lower confidence, add warnings, and still return the best safe structured answerData you can justify from the source.",
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
          normalizedQuestion: {
            id: block.id,
            kind: "one allowed kind",
            prompt: [{ type: "text", text: "question prompt" }],
            difficulty: "easy | medium | hard",
            hints: ["optional hint"],
            explanation: "optional explanation",
            answerData: {
              final: {
                type: "choice | number | text | line_equation | point_list | points_on_line",
              },
              finalAnswerText: "required final answer summary",
              solution: "required concise worked solution",
              steps: [
                {
                  id: "step_1",
                  title: "Step 1",
                  prompt: [{ type: "text", text: "step prompt" }],
                  answer: {
                    type: "choice | number | text | line_equation | point_list | points_on_line",
                  },
                  explanation: "optional step explanation",
                },
              ],
              explanationScenes: [
                {
                  id: "scene_1",
                  title: "Plan",
                  narration: "Describe the move",
                  beforeText: "optional before state",
                  afterText: "optional after state",
                  emphasis: ["optional token"],
                  action: "highlight | transform | note | reveal",
                },
              ],
              allowDirectFinalAnswer: true,
            },
          },
        },
        answerTypeGuidance: {
          choice: { type: "choice", choices: ["A", "B"], correctChoiceIndex: 0 },
          number: { type: "number", correct: [2, "2"], tolerance: 0 },
          text: { type: "text", accepted: ["slope = 1"], caseSensitive: false, trim: true },
          line_equation: { type: "line_equation", forms: ["y=x+1", "x-y+1=0"], variable: "y", caseSensitive: false, trim: true },
          point_list: {
            type: "point_list",
            points: [{ x: 0, y: 1 }, { x: 1, y: 3 }],
            minPoints: 2,
            maxPoints: 10,
            ordered: false,
            allowEquivalentOrder: true,
          },
          points_on_line: {
            type: "points_on_line",
            lineForms: ["y=x+1", "x-y+1=0"],
            minPoints: 3,
            maxPoints: 3,
            disallowGivenPoints: [{ x: 0, y: 1 }],
            requireDistinct: true,
          },
        },
        block,
      },
      null,
      2,
    ),
  };
}
