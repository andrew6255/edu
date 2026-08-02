import { createHash } from 'node:crypto';
import type {
  TutorAnnotation,
  TutorAnswerPackage,
  TutorAnswerRequest,
  TutorChatInput,
  TutorChatResult,
  TutorEvaluationInput,
  TutorEvaluationResult,
  TutorPaperGradeRequest,
  TutorPaperGradeResult,
  TutorPaperHelpRequest,
  TutorPaperHelpResult,
  TutorStatusResult,
} from './types';
import { getAiTutorProviderConfig, getExternalAiTutorProvider } from './providers';
import { logger } from '../../lib/logger';
import { readCachedAnswer, writeCachedAnswer } from './answerRepository';

const pendingAnswerRequests = new Map<string, Promise<TutorAnswerPackage>>();

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt.trim().replace(/\s+/g, ' ')).digest('hex');
}

function packageFromExistingAnswer(answer: string): TutorAnswerPackage {
  return {
    modelAnswer: answer,
    highLevelSteps: [],
    fullSolution: [{ title: 'Solution', body: answer }],
    gradingRubric: [{ criterion: 'Correct method and answer', points: 100 }],
    provenance: 'source',
    reviewStatus: 'approved',
    generatedAt: null,
    model: null,
  };
}

function normalizeMathText(value: string): string {
  let s = value;
  for (let safety = 0; safety < 8; safety += 1) {
    const replaced = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    if (replaced === s) break;
    s = replaced;
  }
  return s
    .replace(/\\times/g, '*')
    .replace(/\\cdot/g, '*')
    .replace(/\\/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function extractFinalAnswer(value: string): string {
  const normalized = normalizeMathText(value);
  const parts = normalized.split('=').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? normalized;
}

function evaluateNumericExpression(expression: string): number | null {
  // Allow spaces so "595 + 236" works too
  if (!expression || !/^[\-+*/().0-9×\s]+$/.test(expression)) return null;
  const safe = expression.replace(/×/g, '*').replace(/\s+/g, '');
  try {
    const value = Function(`"use strict"; return (${safe});`)();
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function numericEquals(value: string, target: number): boolean {
  const finalPart = extractFinalAnswer(value);
  const evaluated = evaluateNumericExpression(finalPart);
  if (evaluated === null) return finalPart === String(target);
  return Math.abs(evaluated - target) < 1e-6;
}

function redCircle(targetText: string, text: string): TutorAnnotation {
  return { type: 'circle', targetText, text, color: 'red' };
}

function evaluateSlope(input: TutorEvaluationInput): TutorEvaluationResult {
  const normalized = normalizeMathText(input.recognizedText);
  const correctFormula = normalized.includes('(7-3)/(6-2)') || normalized.includes('(3-7)/(2-6)') || normalized.includes('4/4');
  const correctFinal = numericEquals(input.recognizedText, 1);

  if (correctFormula && correctFinal) {
    return {
      isCorrect: true,
      stepStatus: 'correct',
      detectedMistake: null,
      studentMessage: 'Correct. You used the slope formula and got m = 1.',
      hint: null,
      annotations: [{ type: 'underline', targetText: extractFinalAnswer(input.recognizedText), text: 'm = 1', color: 'green' }],
      nextExpectedStep: 'Now use y = mx + b to find b.',
    };
  }

  if (normalized.includes('7-2') || normalized.includes('(7-2)/(6-2)')) {
    return {
      isCorrect: false,
      stepStatus: 'incorrect',
      detectedMistake: 'The numerator uses 7 - 2, but slope needs y2 - y1, so it should be 7 - 3.',
      studentMessage: 'Your denominator uses the x-values correctly, but the numerator should use the y-values: 7 - 3, not 7 - 2.',
      hint: 'For slope, use change in y over change in x.',
      annotations: [redCircle('7-2', 'Use y-values: 7 - 3')],
      nextExpectedStep: 'Replace 7 - 2 with 7 - 3.',
    };
  }

  if (normalized.includes('6-3') || normalized.includes('(7-3)/(6-3)')) {
    return {
      isCorrect: false,
      stepStatus: 'incorrect',
      detectedMistake: 'The denominator should use the x-values 6 and 2, so it should be 6 - 2.',
      studentMessage: 'The numerator looks like the y-change, but the denominator should be the x-change: 6 - 2.',
      hint: 'The x-values are 2 and 6.',
      annotations: [redCircle('6-3', 'Use x-values: 6 - 2')],
      nextExpectedStep: 'Use (7 - 3) / (6 - 2).',
    };
  }

  if (correctFinal) {
    return {
      isCorrect: true,
      stepStatus: 'partially_correct',
      detectedMistake: null,
      studentMessage: 'Your final slope is correct: m = 1. Try to also show the formula m = (7 - 3) / (6 - 2).',
      hint: null,
      annotations: [{ type: 'underline', targetText: extractFinalAnswer(input.recognizedText), text: 'Correct final value', color: 'green' }],
      nextExpectedStep: 'Now find b using y = mx + b.',
    };
  }

  return {
    isCorrect: false,
    stepStatus: 'unclear',
    detectedMistake: 'The slope work does not yet show the expected formula or final value.',
    studentMessage: 'I could not verify the slope yet. Start with m = (y2 - y1) / (x2 - x1), then substitute the two points.',
    hint: 'Use (7 - 3) / (6 - 2).',
    annotations: [{ type: 'write_text', text: 'Try: m = (7 - 3) / (6 - 2)', color: 'red' }],
    nextExpectedStep: 'Write m = (7 - 3) / (6 - 2).',
  };
}

function evaluateIntercept(input: TutorEvaluationInput): TutorEvaluationResult {
  const normalized = normalizeMathText(input.recognizedText);
  const correctFinal = numericEquals(input.recognizedText, 1);
  const showsSubstitution = normalized.includes('3=2+1') || normalized.includes('3=2+b') || normalized.includes('b=1');

  if (correctFinal || showsSubstitution) {
    return {
      isCorrect: true,
      stepStatus: 'correct',
      detectedMistake: null,
      studentMessage: 'Correct. The y-intercept is b = 1.',
      hint: null,
      annotations: [{ type: 'underline', targetText: '1', text: 'b = 1', color: 'green' }],
      nextExpectedStep: 'Combine m = 1 and b = 1 to write y = x + 1.',
    };
  }

  return {
    isCorrect: false,
    stepStatus: 'incorrect',
    detectedMistake: 'The intercept should be 1 after substituting point (2, 3) into y = x + b.',
    studentMessage: 'Use point (2, 3): 3 = 1·2 + b, so b = 1.',
    hint: 'Substitute x = 2 and y = 3 into y = mx + b.',
    annotations: [{ type: 'write_text', text: '3 = 2 + b, so b = 1', color: 'red' }],
    nextExpectedStep: 'Solve 3 = 2 + b.',
  };
}

function evaluateEquation(input: TutorEvaluationInput): TutorEvaluationResult {
  const normalized = normalizeMathText(input.recognizedText);
  const correct = normalized === 'y=x+1' || normalized === 'y=1+x' || normalized === 'x-y+1=0';

  return correct
    ? {
        isCorrect: true,
        stepStatus: 'correct',
        detectedMistake: null,
        studentMessage: 'Correct. The equation is y = x + 1.',
        hint: null,
        annotations: [{ type: 'underline', targetText: input.recognizedText, text: 'Correct equation', color: 'green' }],
        nextExpectedStep: 'Now give one more point on this line.',
      }
    : {
        isCorrect: false,
        stepStatus: 'incorrect',
        detectedMistake: 'The equation should use slope 1 and intercept 1.',
        studentMessage: 'The line has m = 1 and b = 1, so the equation should be y = x + 1.',
        hint: 'Use y = mx + b.',
        annotations: [{ type: 'write_text', text: 'y = x + 1', color: 'red' }],
        nextExpectedStep: 'Write y = x + 1.',
      };
}

function evaluatePoint(input: TutorEvaluationInput): TutorEvaluationResult {
  const normalized = normalizeMathText(input.recognizedText);
  const match = normalized.match(/^\(?(-?\d+(?:\.\d+)?)[^\d\-.]+(-?\d+(?:\.\d+)?)\)?$/);
  if (match) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (Math.abs(y - (x + 1)) < 1e-6) {
      return {
        isCorrect: true,
        stepStatus: 'correct',
        detectedMistake: null,
        studentMessage: 'Correct. That point lies on y = x + 1.',
        hint: null,
        annotations: [{ type: 'underline', targetText: input.recognizedText, text: 'Valid point', color: 'green' }],
        nextExpectedStep: null,
      };
    }
  }

  return {
    isCorrect: false,
    stepStatus: 'incorrect',
    detectedMistake: 'The point must satisfy y = x + 1.',
    studentMessage: 'For a point on this line, the y-value must be exactly 1 more than the x-value.',
    hint: 'Examples include (0, 1), (2, 3), and (7, 8).',
    annotations: [{ type: 'write_text', text: 'Need y = x + 1', color: 'red' }],
    nextExpectedStep: 'Try a point like (0, 1) or (7, 8).',
  };
}

/**
 * Pre-check for simple arithmetic questions (e.g. "595+236", "12*7").
 * Extracts the expression from the question prompt, evaluates it exactly,
 * then checks if the student's recognized text contains that answer.
 * Returns a TutorEvaluationResult if it can make a confident determination,
 * or null to fall through to the LLM.
 */
function tryArithmeticPreCheck(input: TutorEvaluationInput): TutorEvaluationResult | null {
  const question = input.questionPrompt.trim();
  const studentText = input.recognizedText.trim();

  // Extract a bare arithmetic expression from the question (strips labels/punctuation)
  const exprMatch = question.match(/([\d][\d\s+\-*/×().]*[\d])/);
  if (!exprMatch) return null;

  const expr = exprMatch[1].trim();
  const correctValue = evaluateNumericExpression(expr);
  if (correctValue === null) return null;

  // Try to extract a number from the student's answer (final number they wrote)
  const studentNumbers = studentText.match(/-?\d+(?:\.\d+)?/g);
  if (!studentNumbers || studentNumbers.length === 0) return null;

  // Use the last number the student wrote as their final answer
  const studentValue = Number(studentNumbers[studentNumbers.length - 1]);
  if (!Number.isFinite(studentValue)) return null;

  const tolerance = Math.abs(correctValue) < 1 ? 1e-9 : Math.abs(correctValue) * 1e-9;
  const isCorrect = Math.abs(studentValue - correctValue) <= tolerance;

  if (isCorrect) {
    return {
      isCorrect: true,
      stepStatus: 'correct',
      detectedMistake: null,
      studentMessage: `Correct! ${expr} = ${correctValue}.`,
      hint: null,
      annotations: [{ type: 'underline', targetText: String(studentValue), text: '✓', color: 'green' }],
      nextExpectedStep: null,
    };
  }

  return {
    isCorrect: false,
    stepStatus: 'incorrect',
    detectedMistake: `Expected ${correctValue}, but got ${studentValue}.`,
    studentMessage: `Not quite. ${expr} = ${correctValue}, but you wrote ${studentValue}. Double-check your arithmetic.`,
    hint: `Try computing ${expr} step by step.`,
    annotations: [{ type: 'circle', targetText: String(studentValue), text: `Should be ${correctValue}`, color: 'red' }],
    nextExpectedStep: `Write ${expr} = ${correctValue}.`,
  };
}

export class AiTutorService {
  getStatus(): TutorStatusResult {
    const { apiKey, model } = getAiTutorProviderConfig();
    return apiKey
      ? { mode: 'external', provider: 'openai_compatible', model, visionEnabled: true }
      : { mode: 'deterministic', provider: 'local', model: null, visionEnabled: false };
  }

  async evaluateWork(input: TutorEvaluationInput): Promise<TutorEvaluationResult> {
    // 1. Try deterministic arithmetic pre-check first (no LLM, no hallucinations)
    const arithmeticResult = tryArithmeticPreCheck(input);
    if (arithmeticResult) {
      logger.info('[ai-tutor] arithmetic pre-check resolved evaluation deterministically');
      return arithmeticResult;
    }

    // 2. Try external AI provider
    const external = getExternalAiTutorProvider();
    if (external) {
      try {
        const result = await external.evaluateWork(input);
        if (result) return result;
      } catch (error) {
        logger.warn({ err: error }, '[ai-tutor] external evaluate failed, falling back');
      }
    }

    if (input.activeStepId === 'slope') return evaluateSlope(input);
    if (input.activeStepId === 'intercept') return evaluateIntercept(input);
    if (input.activeStepId === 'equation') return evaluateEquation(input);
    if (input.activeStepId === 'point') return evaluatePoint(input);

    return {
      isCorrect: false,
      stepStatus: 'unclear',
      detectedMistake: null,
      studentMessage: 'I can read your work, but this step does not have tutor logic configured yet.',
      hint: 'Ask for a hint or try showing the next algebra step.',
      annotations: [],
      nextExpectedStep: null,
    };
  }

  async getOrGenerateAnswer(input: TutorAnswerRequest): Promise<TutorAnswerPackage> {
    if (input.existingAnswer) return packageFromExistingAnswer(input.existingAnswer);
    const hash = promptHash(input.questionPrompt);
    const cached = await readCachedAnswer(input.programId, input.questionId, hash);
    if (cached) return cached;

    const requestKey = `${input.programId || 'unscoped'}::${input.questionId}::${hash}`;
    const inFlight = pendingAnswerRequests.get(requestKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const external = getExternalAiTutorProvider();
      if (!external) throw new Error('AI answer generation is not configured on the API server.');
      const generated = await external.generateAnswer(input.questionPrompt);
      if (!generated) throw new Error('The AI could not generate a valid answer package.');
      await writeCachedAnswer(input.programId, input.questionId, hash, generated);
      return generated;
    })();
    pendingAnswerRequests.set(requestKey, promise);
    try {
      return await promise;
    } finally {
      pendingAnswerRequests.delete(requestKey);
    }
  }

  async findAnswer(input: TutorAnswerRequest): Promise<TutorAnswerPackage | null> {
    if (input.existingAnswer) return packageFromExistingAnswer(input.existingAnswer);
    return readCachedAnswer(input.programId, input.questionId, promptHash(input.questionPrompt));
  }

  async getPaperHelp(input: TutorPaperHelpRequest): Promise<TutorPaperHelpResult> {
    const answerPackage = input.answerPackage ?? await this.getOrGenerateAnswer({
      programId: input.programId,
      questionId: input.questionId,
      questionPrompt: input.questionPrompt,
    });
    if (input.mode === 'solve') {
      return {
        mode: 'solve',
        steps: answerPackage.fullSolution.map(step => ({ title: step.title, body: step.body })),
        answerPackage,
      };
    }
    const external = getExternalAiTutorProvider();
    if (!external) {
      const steps = input.mode === 'hint'
          ? answerPackage.highLevelSteps.slice(0, 1).map(title => ({ title, body: null }))
          : answerPackage.highLevelSteps.map(title => ({ title, body: null }));
      return { mode: input.mode, steps, answerPackage };
    }
    const result = await external.paperHelp(input, answerPackage);
    if (!result) throw new Error('The AI could not produce worksheet guidance.');
    return result;
  }

  async gradePaper(input: TutorPaperGradeRequest): Promise<TutorPaperGradeResult> {
    const answerPackage = input.answerPackage ?? await this.getOrGenerateAnswer({
      questionId: input.questionId,
      questionPrompt: input.questionPrompt,
    });
    const external = getExternalAiTutorProvider();
    if (!external) throw new Error('AI paper grading is not configured on the API server.');
    const result = await external.gradePaper(input, answerPackage);
    if (!result) throw new Error('The AI could not grade this paper.');
    return result;
  }

  async chat(input: TutorChatInput): Promise<TutorChatResult> {
    const external = getExternalAiTutorProvider();
    if (external) {
      try {
        const result = await external.chat(input);
        if (result) return result;
      } catch (error) {
        logger.warn({ err: error }, '[ai-tutor] external chat failed, falling back');
      }
    }

    const message = input.message.toLowerCase();
    const work = input.recognizedText?.trim();
    const latest = input.latestEvaluation;

    if (message.includes('hint')) {
      if (latest?.hint) return { reply: latest.hint, suggestedActions: ['Explain this hint', 'Check my work again'] };
      if (input.activeStepId === 'slope') return { reply: 'Use the slope formula: m = (y₂ - y₁) / (x₂ - x₁). For points (2,3) and (6,7), compare the y-values first.', suggestedActions: ['Show the formula', 'What are y-values?'] };
      if (input.activeStepId === 'intercept') return { reply: 'Use y = mx + b. Since m = 1, substitute one point, for example (2,3): 3 = 1·2 + b.', suggestedActions: ['Solve for b', 'Why use (2,3)?'] };
      if (input.activeStepId === 'equation') return { reply: 'Combine the slope and intercept in y = mx + b. Here m = 1 and b = 1.', suggestedActions: ['Write final equation'] };
      return { reply: 'For a point on y = x + 1, choose any x, then make y one more than x.', suggestedActions: ['Give examples'] };
    }

    if (message.includes('explain') || message.includes('why')) {
      if (latest?.detectedMistake) {
        return { reply: `${latest.detectedMistake} ${latest.studentMessage}`, suggestedActions: ['Give me a simpler hint', 'What should I write next?'] };
      }
      if (input.activeStepId === 'slope') {
        return { reply: 'Slope measures how much y changes for each change in x. From (2,3) to (6,7), y changes by 7 - 3 = 4 and x changes by 6 - 2 = 4, so m = 4 / 4 = 1.', suggestedActions: ['Check my work', 'Next step'] };
      }
      return { reply: 'I look at the current step, your recognized work, and the expected reasoning. Then I point out the first mismatch so you can correct one thing at a time.', suggestedActions: ['Give me a hint', 'What should I do next?'] };
    }

    if (message.includes('next')) {
      if (latest?.nextExpectedStep) return { reply: latest.nextExpectedStep, suggestedActions: ['Explain why', 'Give me a hint'] };
      if (input.activeStepId === 'slope') return { reply: 'Write m = (7 - 3) / (6 - 2), then simplify to m = 1.', suggestedActions: ['Explain slope'] };
      if (input.activeStepId === 'intercept') return { reply: 'Substitute into y = mx + b: 3 = 1·2 + b, then solve b = 1.', suggestedActions: ['Explain intercept'] };
      if (input.activeStepId === 'equation') return { reply: 'Write the equation as y = x + 1.', suggestedActions: ['Check equation'] };
      return { reply: 'Try a point such as (0,1), (2,3), or (7,8).', suggestedActions: ['Why does that work?'] };
    }

    if (work) {
      return { reply: latest?.studentMessage ?? `I can see your current work as: ${work}. Ask for a hint, an explanation, or what to do next.`, suggestedActions: ['Give me a hint', 'Explain my mistake', 'What should I do next?'] };
    }

    return { reply: `We are on: ${input.activeStepTitle ?? input.activeStepId}. Write your work on the pad, then I can check it. You can also ask for a hint.`, suggestedActions: ['Give me a hint', 'Explain this step'] };
  }
}

export const aiTutorService = new AiTutorService();
