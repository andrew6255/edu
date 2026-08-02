import type {
  TutorAnswerPackage,
  TutorAnswerRequest,
  TutorChatInput,
  TutorConversationMessage,
  TutorEvaluationInput,
  TutorEvaluationResult,
  TutorPaperGradeRequest,
  TutorPaperHelpRequest,
} from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function imageDataUrlValue(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  if (!text.startsWith('data:image/')) return null;
  if (text.length > 1_500_000) throw new Error('canvasImageBase64 is too large.');
  return text;
}

function parseConversation(value: unknown): TutorConversationMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const role = record.role === 'student' || record.role === 'tutor' ? record.role : null;
      const content = stringValue(record.content);
      if (!role || !content) return null;
      return { role, content };
    })
    .filter((entry): entry is TutorConversationMessage => entry !== null);
  return parsed.length > 0 ? parsed.slice(-12) : undefined;
}

export function parseTutorEvaluationInput(value: unknown): TutorEvaluationInput {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid tutor evaluation payload.');

  const questionPrompt = stringValue(record.questionPrompt);
  const activeStepId = stringValue(record.activeStepId);
  const recognizedText = stringValue(record.recognizedText);

  if (!questionPrompt) throw new Error('questionPrompt is required.');
  if (!activeStepId) throw new Error('activeStepId is required.');
  if (!recognizedText) throw new Error('recognizedText is required.');

  return {
    questionId: stringValue(record.questionId),
    questionPrompt,
    activeStepId,
    activeStepTitle: stringValue(record.activeStepTitle),
    recognizedText,
    recognizedLatex: stringValue(record.recognizedLatex) ?? null,
    canvasImageBase64: imageDataUrlValue(record.canvasImageBase64),
    expectedAnswer: stringValue(record.expectedAnswer) ?? null,
    expectedReasoning: stringValue(record.expectedReasoning) ?? null,
    conversation: parseConversation(record.conversation),
  };
}

function parseLatestEvaluation(value: unknown): TutorEvaluationResult | null {
  const record = asRecord(value);
  if (!record) return null;
  const stepStatus = record.stepStatus === 'correct' || record.stepStatus === 'partially_correct' || record.stepStatus === 'incorrect' || record.stepStatus === 'unclear'
    ? record.stepStatus
    : 'unclear';
  return {
    isCorrect: record.isCorrect === true,
    stepStatus,
    detectedMistake: stringValue(record.detectedMistake) ?? null,
    studentMessage: stringValue(record.studentMessage) ?? '',
    hint: stringValue(record.hint) ?? null,
    annotations: [],
    nextExpectedStep: stringValue(record.nextExpectedStep) ?? null,
  };
}

export function parseTutorChatInput(value: unknown): TutorChatInput {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid tutor chat payload.');

  const questionPrompt = stringValue(record.questionPrompt);
  const activeStepId = stringValue(record.activeStepId);
  const message = stringValue(record.message);

  if (!questionPrompt) throw new Error('questionPrompt is required.');
  if (!activeStepId) throw new Error('activeStepId is required.');
  if (!message) throw new Error('message is required.');

  return {
    questionId: stringValue(record.questionId),
    questionPrompt,
    activeStepId,
    activeStepTitle: stringValue(record.activeStepTitle),
    recognizedText: stringValue(record.recognizedText) ?? null,
    canvasImageBase64: imageDataUrlValue(record.canvasImageBase64),
    latestEvaluation: parseLatestEvaluation(record.latestEvaluation),
    message,
    conversation: parseConversation(record.conversation),
  };
}

function requiredString(record: Record<string, unknown>, key: string, maxLength = 40_000): string {
  const value = stringValue(record[key]);
  if (!value) throw new Error(`${key} is required.`);
  if (value.length > maxLength) throw new Error(`${key} is too long.`);
  return value;
}

function parseAnswerPackage(value: unknown): TutorAnswerPackage | null {
  const record = asRecord(value);
  if (!record) return null;
  const modelAnswer = stringValue(record.modelAnswer);
  if (!modelAnswer) return null;
  const highLevelSteps = Array.isArray(record.highLevelSteps)
    ? record.highLevelSteps.map(stringValue).filter((entry): entry is string => !!entry).slice(0, 12)
    : [];
  const fullSolution = Array.isArray(record.fullSolution)
    ? record.fullSolution.map((entry) => {
        const item = asRecord(entry);
        const title = item ? stringValue(item.title) : undefined;
        const body = item ? stringValue(item.body) : undefined;
        return title && body ? { title, body } : null;
      }).filter((entry): entry is { title: string; body: string } => entry !== null).slice(0, 12)
    : [];
  const gradingRubric = Array.isArray(record.gradingRubric)
    ? record.gradingRubric.map((entry) => {
        const item = asRecord(entry);
        const criterion = item ? stringValue(item.criterion) : undefined;
        const points = item && typeof item.points === 'number' && Number.isFinite(item.points) ? item.points : null;
        return criterion && points !== null ? { criterion, points } : null;
      }).filter((entry): entry is { criterion: string; points: number } => entry !== null).slice(0, 12)
    : [];
  return {
    modelAnswer,
    highLevelSteps,
    fullSolution,
    gradingRubric,
    provenance: record.provenance === 'source' ? 'source' : 'ai_generated',
    reviewStatus: record.reviewStatus === 'approved' ? 'approved' : 'pending_review',
    generatedAt: stringValue(record.generatedAt) ?? null,
    model: stringValue(record.model) ?? null,
  };
}

export function parseTutorAnswerRequest(value: unknown): TutorAnswerRequest {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid answer-generation payload.');
  return {
    programId: stringValue(record.programId),
    questionId: requiredString(record, 'questionId', 300),
    questionPrompt: requiredString(record, 'questionPrompt'),
    existingAnswer: stringValue(record.existingAnswer) ?? null,
  };
}

export function parseTutorPaperHelpRequest(value: unknown): TutorPaperHelpRequest {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid paper-help payload.');
  const mode = record.mode === 'steps' || record.mode === 'next_step' || record.mode === 'solve' ? record.mode : null;
  if (!mode) throw new Error('mode must be steps, next_step, or solve.');
  return {
    mode,
    programId: stringValue(record.programId),
    questionId: requiredString(record, 'questionId', 300),
    questionPrompt: requiredString(record, 'questionPrompt'),
    subQuestionId: stringValue(record.subQuestionId) ?? null,
    subQuestionPrompt: stringValue(record.subQuestionPrompt) ?? null,
    recognizedWork: stringValue(record.recognizedWork) ?? null,
    answerPackage: parseAnswerPackage(record.answerPackage),
  };
}

export function parseTutorPaperGradeRequest(value: unknown): TutorPaperGradeRequest {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid paper-grade payload.');
  if (!Array.isArray(record.parts) || record.parts.length === 0) throw new Error('parts are required.');
  const parts = record.parts.slice(0, 30).map((entry, index) => {
    const item = asRecord(entry);
    if (!item) throw new Error(`parts[${index}] is invalid.`);
    return {
      id: requiredString(item, 'id', 300),
      prompt: requiredString(item, 'prompt'),
      recognizedWork: stringValue(item.recognizedWork) ?? '',
      hasStudentWork: item.hasStudentWork === true,
    };
  });
  return {
    questionId: requiredString(record, 'questionId', 300),
    questionPrompt: requiredString(record, 'questionPrompt'),
    assisted: record.assisted === true,
    answerPackage: parseAnswerPackage(record.answerPackage),
    parts,
  };
}
