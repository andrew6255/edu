import type { AiQuestionAnalysis, ExtractedQuestionBlock, Question } from "./types";

function looksLikeMcq(text: string): boolean {
  return /\b[A-D][).]\s+/m.test(text);
}

function looksLikeTrueFalse(text: string): boolean {
  return /\btrue\b|\bfalse\b/i.test(text);
}

function extractPointPairs(text: string): Array<{ x: number; y: number }> {
  return Array.from(text.matchAll(/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g))
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function makeLineEquationFormsFromPoints(points: Array<{ x: number; y: number }>): string[] {
  if (points.length < 2) return [];
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0) return [`x=${a.x}`];
  const m = dy / dx;
  const c = a.y - m * a.x;
  const mText = Number.isInteger(m) ? String(m) : String(Number(m.toFixed(6)));
  const cAbs = Math.abs(c);
  const cText = Number.isInteger(cAbs) ? String(cAbs) : String(Number(cAbs.toFixed(6)));
  const slopeIntercept = c === 0 ? `y=${mText}x` : `y=${mText}x${c > 0 ? "+" : "-"}${cText}`;
  const standard = `${mText}x-y${c === 0 ? "" : `${c > 0 ? "+" : "-"}${cText}`}=0`;
  return Array.from(new Set([slopeIntercept, standard].map((value) => value.replace(/\s+/g, ""))));
}

function makeGeneratedPointsFromEquation(text: string): Array<{ x: number; y: number }> {
  const match = text.match(/y\s*=\s*([+-]?(?:\d+(?:\.\d+)?)?)x\s*([+-]\s*\d+(?:\.\d+)?)?/i);
  if (!match) return [];
  const mRaw = (match[1] ?? "1").trim();
  const bRaw = (match[2] ?? "0").replace(/\s+/g, "").trim();
  const m = mRaw === "+" || mRaw === "" ? 1 : (mRaw === "-" ? -1 : Number(mRaw));
  const b = Number(bRaw || 0);
  if (!Number.isFinite(m) || !Number.isFinite(b)) return [];
  return Array.from({ length: 10 }, (_, idx) => {
    const x = idx;
    return { x, y: m * x + b };
  });
}

function makeExplanationScenes(solution: string, finalAnswerText: string): NonNullable<Question["answerData"]["explanationScenes"]> {
  const trimmedSolution = solution.trim();
  const trimmedFinal = finalAnswerText.trim();
  const scenes: NonNullable<Question["answerData"]["explanationScenes"]> = [];
  if (trimmedSolution) {
    scenes.push({
      id: "scene_strategy",
      title: "Plan",
      narration: trimmedSolution,
      afterText: trimmedSolution,
      action: "note",
    });
  }
  if (trimmedFinal) {
    scenes.push({
      id: "scene_result",
      title: "Result",
      narration: trimmedFinal,
      afterText: trimmedFinal,
      action: "reveal",
    });
  }
  return scenes;
}

function makeAdditionalPointsFromLine(points: Array<{ x: number; y: number }>, count: number): Array<{ x: number; y: number }> {
  if (points.length < 2 || count <= 0) return [];
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0) {
    return Array.from({ length: count }, (_, idx) => ({ x: a.x, y: a.y + (idx + 1) }));
  }
  return Array.from({ length: count }, (_, idx) => {
    const step = idx + 1;
    return { x: a.x + dx * step, y: a.y + dy * step };
  });
}

export function normalizeQuestionBlock(block: ExtractedQuestionBlock): AiQuestionAnalysis {
  const raw = block.rawText.trim();
  const warnings = [...(block.notes ?? [])];
  const lower = raw.toLowerCase();
  const pointPairs = extractPointPairs(raw);

  let detectedKind: AiQuestionAnalysis["detectedKind"] = "open_response_ai";
  let recommendedGradingMode: AiQuestionAnalysis["recommendedGradingMode"] = "ai_rubric";

  let structuredAnswer: Question["answerData"]["final"] = null;
  let finalAnswerText = "";
  let solution = "";
  let steps: NonNullable<Question["answerData"]["steps"]> = [];
  let explanationScenes: NonNullable<Question["answerData"]["explanationScenes"]> = [];
  let grading: Question["grading"] = {
    mode: "ai_rubric",
    answerFormat: "open_text",
    rubricVersion: "v1-draft",
  };

  if (/find the equation of the line/.test(lower) && pointPairs.length >= 2) {
    detectedKind = "equation_input";
    recommendedGradingMode = "deterministic";
    const forms = makeLineEquationFormsFromPoints(pointPairs);
    structuredAnswer = forms.length > 0 ? { type: "line_equation", forms, variable: "y", trim: true, caseSensitive: false } : null;
    finalAnswerText = forms[0] ?? "";
    solution = "Compute the slope from the two given points, then substitute one point to obtain the line equation.";
    grading = { mode: "deterministic", answerFormat: "equation" };
  } else if (/list\s+10\s+points|generate\s+10\s+points/.test(lower) && /y\s*=/.test(lower)) {
    detectedKind = "ordered_steps";
    recommendedGradingMode = "deterministic";
    const generated = makeGeneratedPointsFromEquation(raw);
    structuredAnswer = generated.length > 0
      ? { type: "point_list", points: generated, minPoints: 10, maxPoints: 10, ordered: false, allowEquivalentOrder: true }
      : null;
    finalAnswerText = generated.map((p) => `(${p.x}, ${p.y})`).join(", ");
    solution = "Choose values of x and substitute them into the line equation to generate valid coordinate pairs.";
    grading = { mode: "deterministic", answerFormat: "text" };
  } else if (/find\s+3\s+other\s+points/.test(lower) && pointPairs.length >= 2) {
    detectedKind = "ordered_steps";
    recommendedGradingMode = "step_based";
    const forms = makeLineEquationFormsFromPoints(pointPairs);
    structuredAnswer = forms.length > 0 ? { type: "line_equation", forms, variable: "y", trim: true, caseSensitive: false } : null;
    finalAnswerText = forms[0] ?? "";
    solution = "First determine the equation of the line from the two given points, then substitute new x-values to obtain three additional points on the same line.";
    steps = forms.length > 0
      ? [
          {
            id: "step_points",
            title: "Three other points on the line",
            prompt: [{ type: "text", text: "Enter three other points that lie on the same line." }],
            answer: {
              type: "points_on_line",
              lineForms: forms,
              minPoints: 3,
              maxPoints: 3,
              disallowGivenPoints: pointPairs.slice(0, 2),
              requireDistinct: true,
            },
            explanation: "Any three distinct points on the same line are acceptable if they satisfy the equation.",
          },
        ]
      : [];
    grading = { mode: "step_based", answerFormat: "final_with_optional_working", scoreStrategy: "final_plus_steps" };
  } else if (looksLikeMcq(raw)) {
    detectedKind = "mcq_single";
    recommendedGradingMode = "deterministic";
    warnings.push("MCQ options detected, but option parsing/answer-key extraction is not implemented yet.");
    grading = { mode: "deterministic", answerFormat: "choice" };
  } else if (looksLikeTrueFalse(raw)) {
    detectedKind = "true_false";
    recommendedGradingMode = "deterministic";
    warnings.push("True/False wording detected, but answer-key extraction is not implemented yet.");
    grading = { mode: "deterministic", answerFormat: "choice" };
  }

  explanationScenes = makeExplanationScenes(solution, finalAnswerText);

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
        answerData: {
          final: structuredAnswer,
          finalAnswerText,
          solution,
          steps,
          explanationScenes,
          allowDirectFinalAnswer: true,
        },
        review: {
          status: "needs_review",
          flags: [],
        },
        grading,
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
        answerData: {
          final: structuredAnswer,
          finalAnswerText,
          solution,
          steps,
          explanationScenes,
          allowDirectFinalAnswer: true,
        },
        review: {
          status: "needs_review",
          flags: [],
        },
        grading,
      };

  return {
    detectedKind,
    confidence: block.splitConfidence ?? 0.5,
    isMultiPart: /\([a-zA-Z]\)/.test(raw),
    needsDiagram: false,
    autoGradable: detectedKind !== "open_response_ai" || !!structuredAnswer,
    recommendedGradingMode,
    warnings,
    normalizedQuestion,
  };
}
