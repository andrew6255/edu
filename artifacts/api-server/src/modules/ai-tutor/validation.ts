import type { TutorChatInput, TutorConversationMessage, TutorEvaluationInput, TutorEvaluationResult } from './types';

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
