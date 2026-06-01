export const NOTEBOOK_QUESTION_FORMATS = [
  'numeric_answer',
  'expression_input',
  'equation_input',
  'multiple_choice',
  'fill_in_blank',
  'table_completion',
  'ordering',
  'open_explanation',
  'step_by_step_solve',
  'true_false',
] as const;

export const NOTEBOOK_ANSWER_TYPES = [
  'number',
  'text',
  'expression',
  'equation',
  'ordering',
  'table',
  'explanation',
] as const;

export type NotebookQuestionFormat = typeof NOTEBOOK_QUESTION_FORMATS[number];
export type NotebookAnswerType = typeof NOTEBOOK_ANSWER_TYPES[number];
export type NotebookDifficulty = 'easy' | 'medium' | 'hard';
export type NotebookValidationSeverity = 'error' | 'warning' | 'info';

export type NotebookImportChoice = {
  choiceId: string;
  text: string;
};

export type NotebookImportPart = {
  partId: string;
  label: string;
  prompt: string;
  answer: string;
  answerType: NotebookAnswerType;
  solutionSteps: string[];
  hints: string[];
  commonMistakes: string[];
};

export type NotebookImportQuestion = {
  questionId: string;
  sourcePage: number | null;
  questionNumber: string;
  topicId: string;
  skillId: string;
  questionFormat: NotebookQuestionFormat;
  pedagogicalStyle: string;
  contextType: string;
  difficulty: NotebookDifficulty;
  questionText: string;
  parts: NotebookImportPart[];
  choices: NotebookImportChoice[];
  correctChoiceIds: string[];
  requiresDiagram: boolean;
  diagramDescription: string;
  needsManualReview: boolean;
  reviewReason: string;
};

export type NotebookExerciseImport = {
  chapterId: string;
  chapterTitle: string;
  sourceExercise: string;
  questions: NotebookImportQuestion[];
  continueFrom: string | null;
  extractionWarnings: string[];
};

export type NotebookValidationIssue = {
  severity: NotebookValidationSeverity;
  path: string;
  message: string;
};

export type NotebookImportSummary = {
  chapterId: string;
  chapterTitle: string;
  sourceExercise: string;
  questionCount: number;
  partCount: number;
  manualReviewCount: number;
  sourceAssetCount: number;
  formatCounts: Record<string, number>;
  difficultyCounts: Record<string, number>;
  continueFrom: string | null;
};

export type NotebookValidationResult = {
  payload: NotebookExerciseImport | null;
  summary: NotebookImportSummary | null;
  issues: NotebookValidationIssue[];
  errorCount: number;
  warningCount: number;
};

export type NotebookBuilderQuestion = {
  id: string;
  question: string;
  options: string[];
  correct_option_index: number;
  difficulty: NotebookDifficulty;
  hint?: string[] | null;
  solution?: string | null;
  points?: number;
  promptBlocks?: Array<{ type: 'text'; text: string }>;
  interaction:
    | { type: 'mcq'; choices: string[]; correctChoiceIndex: number }
    | { type: 'numeric'; correct: number; tolerance?: number; format?: 'integer' | 'decimal'; keypad?: 'basic' | 'scientific' }
    | { type: 'text'; accepted: string[]; caseSensitive?: boolean; trim?: boolean }
    | { type: 'freeform'; grading: 'ai' | 'manual'; placeholder?: string; rubricSummary?: string | null; acceptSteps?: boolean };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function pushIssue(issues: NotebookValidationIssue[], severity: NotebookValidationSeverity, path: string, message: string): void {
  issues.push({ severity, path, message });
}

function normalizeChoice(value: unknown): NotebookImportChoice {
  const record = asRecord(value) ?? {};
  return {
    choiceId: stringValue(record.choiceId),
    text: stringValue(record.text),
  };
}

function normalizePart(value: unknown): NotebookImportPart {
  const record = asRecord(value) ?? {};
  const rawAnswerType = stringValue(record.answerType) as NotebookAnswerType;
  return {
    partId: stringValue(record.partId),
    label: stringValue(record.label),
    prompt: stringValue(record.prompt),
    answer: String(record.answer ?? ''),
    answerType: NOTEBOOK_ANSWER_TYPES.includes(rawAnswerType) ? rawAnswerType : 'text',
    solutionSteps: stringArray(record.solutionSteps),
    hints: stringArray(record.hints),
    commonMistakes: stringArray(record.commonMistakes),
  };
}

function normalizeQuestion(value: unknown): NotebookImportQuestion {
  const record = asRecord(value) ?? {};
  const rawFormat = stringValue(record.questionFormat) as NotebookQuestionFormat;
  const rawDifficulty = stringValue(record.difficulty) as NotebookDifficulty;
  return {
    questionId: stringValue(record.questionId),
    sourcePage: typeof record.sourcePage === 'number' && Number.isFinite(record.sourcePage) ? record.sourcePage : null,
    questionNumber: stringValue(record.questionNumber),
    topicId: stringValue(record.topicId),
    skillId: stringValue(record.skillId),
    questionFormat: NOTEBOOK_QUESTION_FORMATS.includes(rawFormat) ? rawFormat : 'numeric_answer',
    pedagogicalStyle: stringValue(record.pedagogicalStyle),
    contextType: stringValue(record.contextType),
    difficulty: ['easy', 'medium', 'hard'].includes(rawDifficulty) ? rawDifficulty : 'medium',
    questionText: stringValue(record.questionText),
    parts: Array.isArray(record.parts) ? record.parts.map(normalizePart) : [],
    choices: Array.isArray(record.choices) ? record.choices.map(normalizeChoice) : [],
    correctChoiceIds: stringArray(record.correctChoiceIds),
    requiresDiagram: record.requiresDiagram === true,
    diagramDescription: stringValue(record.diagramDescription),
    needsManualReview: record.needsManualReview === true,
    reviewReason: stringValue(record.reviewReason),
  };
}

function validateQuestion(question: NotebookImportQuestion, index: number, issues: NotebookValidationIssue[], questionIds: Set<string>, partIds: Set<string>): void {
  const path = `questions[${index}]`;
  if (!question.questionId) pushIssue(issues, 'error', `${path}.questionId`, 'Question is missing questionId.');
  if (question.questionId && questionIds.has(question.questionId)) pushIssue(issues, 'error', `${path}.questionId`, `Duplicate questionId: ${question.questionId}`);
  questionIds.add(question.questionId);
  if (!question.topicId) pushIssue(issues, 'warning', `${path}.topicId`, 'Question is missing topicId.');
  if (!question.skillId) pushIssue(issues, 'warning', `${path}.skillId`, 'Question is missing skillId.');
  if (!question.questionText.trim()) pushIssue(issues, 'warning', `${path}.questionText`, 'Question text is empty.');
  if (question.parts.length === 0) pushIssue(issues, 'error', `${path}.parts`, 'Question must include at least one part.');
  if (question.needsManualReview) pushIssue(issues, 'info', path, question.reviewReason || 'Question is flagged for manual review.');
  if (question.requiresDiagram) pushIssue(issues, 'warning', `${path}.requiresDiagram`, question.diagramDescription || 'Question requires source asset/diagram review.');
  if (question.questionFormat === 'multiple_choice') {
    if (question.choices.length === 0) pushIssue(issues, 'error', `${path}.choices`, 'Multiple choice question has no choices.');
    if (question.correctChoiceIds.length === 0) pushIssue(issues, 'error', `${path}.correctChoiceIds`, 'Multiple choice question has no correctChoiceIds.');
    const choiceIds = new Set(question.choices.map((choice) => choice.choiceId));
    for (const choiceId of question.correctChoiceIds) {
      if (!choiceIds.has(choiceId)) pushIssue(issues, 'error', `${path}.correctChoiceIds`, `Correct choice id ${choiceId} does not exist in choices.`);
    }
  }
  question.parts.forEach((part, partIndex) => {
    const partPath = `${path}.parts[${partIndex}]`;
    if (!part.partId) pushIssue(issues, 'error', `${partPath}.partId`, 'Part is missing partId.');
    if (part.partId && partIds.has(part.partId)) pushIssue(issues, 'error', `${partPath}.partId`, `Duplicate partId: ${part.partId}`);
    partIds.add(part.partId);
    if (!part.prompt.trim() && !question.questionText.trim()) pushIssue(issues, 'warning', `${partPath}.prompt`, 'Part prompt is empty and question text is empty.');
    if (!part.answer.trim()) pushIssue(issues, 'warning', `${partPath}.answer`, 'Part answer is empty.');
    if (question.questionFormat === 'numeric_answer' && part.answerType !== 'number') pushIssue(issues, 'warning', `${partPath}.answerType`, 'numeric_answer question has a non-number answer part.');
    if (question.questionFormat === 'expression_input' && part.answerType !== 'expression') pushIssue(issues, 'warning', `${partPath}.answerType`, 'expression_input question has a non-expression answer part.');
    if (question.questionFormat === 'equation_input' && part.answerType !== 'equation') pushIssue(issues, 'warning', `${partPath}.answerType`, 'equation_input question has a non-equation answer part.');
  });
}

function summarize(payload: NotebookExerciseImport): NotebookImportSummary {
  const formatCounts: Record<string, number> = {};
  const difficultyCounts: Record<string, number> = {};
  let partCount = 0;
  let manualReviewCount = 0;
  let sourceAssetCount = 0;
  for (const question of payload.questions) {
    formatCounts[question.questionFormat] = (formatCounts[question.questionFormat] ?? 0) + 1;
    difficultyCounts[question.difficulty] = (difficultyCounts[question.difficulty] ?? 0) + 1;
    partCount += question.parts.length;
    if (question.needsManualReview) manualReviewCount += 1;
    if (question.requiresDiagram) sourceAssetCount += 1;
  }
  return {
    chapterId: payload.chapterId,
    chapterTitle: payload.chapterTitle,
    sourceExercise: payload.sourceExercise,
    questionCount: payload.questions.length,
    partCount,
    manualReviewCount,
    sourceAssetCount,
    formatCounts,
    difficultyCounts,
    continueFrom: payload.continueFrom,
  };
}

export function validateNotebookExerciseImport(jsonText: string): NotebookValidationResult {
  const issues: NotebookValidationIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { payload: null, summary: null, issues: [{ severity: 'error', path: '$', message: `Invalid JSON: ${message}` }], errorCount: 1, warningCount: 0 };
  }

  const record = asRecord(raw);
  if (!record) {
    return { payload: null, summary: null, issues: [{ severity: 'error', path: '$', message: 'Notebook import must be a JSON object.' }], errorCount: 1, warningCount: 0 };
  }

  const payload: NotebookExerciseImport = {
    chapterId: stringValue(record.chapterId),
    chapterTitle: stringValue(record.chapterTitle),
    sourceExercise: stringValue(record.sourceExercise),
    questions: Array.isArray(record.questions) ? record.questions.map(normalizeQuestion) : [],
    continueFrom: typeof record.continueFrom === 'string' ? record.continueFrom : null,
    extractionWarnings: stringArray(record.extractionWarnings),
  };

  if (!payload.chapterId) pushIssue(issues, 'error', 'chapterId', 'Missing chapterId.');
  if (!payload.chapterTitle) pushIssue(issues, 'warning', 'chapterTitle', 'Missing chapterTitle.');
  if (!payload.sourceExercise) pushIssue(issues, 'warning', 'sourceExercise', 'Missing sourceExercise.');
  if (payload.questions.length === 0) pushIssue(issues, 'error', 'questions', 'Import must include at least one question.');
  if (payload.continueFrom) pushIssue(issues, 'warning', 'continueFrom', `Extraction is incomplete. Continue from: ${payload.continueFrom}`);
  payload.extractionWarnings.forEach((warning, index) => pushIssue(issues, 'warning', `extractionWarnings[${index}]`, warning));

  const questionIds = new Set<string>();
  const partIds = new Set<string>();
  payload.questions.forEach((question, index) => validateQuestion(question, index, issues, questionIds, partIds));

  return {
    payload,
    summary: summarize(payload),
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
  };
}

function answerToNumber(answer: string): number | null {
  const normalized = answer.replace(/\s+/g, '').replace(/,/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function partPrompt(question: NotebookImportQuestion, part: NotebookImportPart): string {
  const label = part.label ? `${part.label}. ` : '';
  const prompt = part.prompt.trim();
  return prompt ? `${question.questionText}\n\n${label}${prompt}` : `${question.questionText}${label ? `\n\n${label}` : ''}`;
}

function partSolution(part: NotebookImportPart): string | null {
  const steps = part.solutionSteps.filter((step) => step.trim());
  if (steps.length > 0) return steps.join('\n');
  return part.answer ? `Answer: ${part.answer}` : null;
}

function convertPartToBuilderQuestion(question: NotebookImportQuestion, part: NotebookImportPart, choiceIndexById: Map<string, number>): NotebookBuilderQuestion {
  const prompt = partPrompt(question, part);
  const common = {
    id: part.partId || `${question.questionId}_${part.label || 'part'}`,
    question: prompt,
    options: [],
    correct_option_index: 0,
    difficulty: question.difficulty,
    hint: part.hints.length > 0 ? part.hints : null,
    solution: partSolution(part),
    points: question.difficulty === 'hard' ? 3 : question.difficulty === 'medium' ? 2 : 1,
    promptBlocks: [{ type: 'text' as const, text: prompt }],
  };

  if (question.questionFormat === 'multiple_choice' && question.choices.length > 0) {
    const correctId = question.correctChoiceIds[0] ?? part.answer;
    const correctChoiceIndex = choiceIndexById.get(correctId) ?? 0;
    const choices = question.choices.map((choice) => choice.text);
    return {
      ...common,
      options: choices,
      correct_option_index: correctChoiceIndex,
      interaction: { type: 'mcq', choices, correctChoiceIndex },
    };
  }

  if (part.answerType === 'number') {
    const correct = answerToNumber(part.answer);
    if (correct !== null) {
      return {
        ...common,
        interaction: {
          type: 'numeric',
          correct,
          tolerance: Number.isInteger(correct) ? 0 : 0.0001,
          format: Number.isInteger(correct) ? 'integer' : 'decimal',
          keypad: 'basic',
        },
      };
    }
  }

  if (part.answerType === 'explanation' || question.questionFormat === 'open_explanation' || question.questionFormat === 'step_by_step_solve') {
    return {
      ...common,
      interaction: {
        type: 'freeform',
        grading: 'ai',
        placeholder: 'Write your reasoning or full working here...',
        rubricSummary: part.answer || question.reviewReason || 'Review for equivalent reasoning.',
        acceptSteps: question.questionFormat === 'step_by_step_solve',
      },
    };
  }

  return {
    ...common,
    interaction: {
      type: 'text',
      accepted: [part.answer].filter(Boolean),
      caseSensitive: false,
      trim: true,
    },
  };
}

export function convertNotebookExerciseToBuilderQuestions(payload: NotebookExerciseImport): NotebookBuilderQuestion[] {
  const builderQuestions: NotebookBuilderQuestion[] = [];
  for (const question of payload.questions) {
    const choiceIndexById = new Map(question.choices.map((choice, index) => [choice.choiceId, index]));
    for (const part of question.parts) {
      builderQuestions.push(convertPartToBuilderQuestion(question, part, choiceIndexById));
    }
  }
  return builderQuestions;
}
