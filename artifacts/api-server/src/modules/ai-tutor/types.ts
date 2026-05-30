export type TutorStepStatus = 'correct' | 'partially_correct' | 'incorrect' | 'unclear';

export type TutorAnnotation = {
  type: 'circle' | 'underline' | 'write_text';
  targetText?: string | null;
  text?: string | null;
  color: 'red' | 'green';
};

export type TutorConversationMessage = {
  role: 'student' | 'tutor';
  content: string;
};

export type TutorEvaluationInput = {
  questionId?: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle?: string;
  recognizedText: string;
  recognizedLatex?: string | null;
  canvasImageBase64?: string | null;
  expectedAnswer?: string | null;
  expectedReasoning?: string | null;
  conversation?: TutorConversationMessage[];
};

export type TutorChatInput = {
  questionId?: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle?: string;
  recognizedText?: string | null;
  canvasImageBase64?: string | null;
  latestEvaluation?: TutorEvaluationResult | null;
  message: string;
  conversation?: TutorConversationMessage[];
};

export type TutorEvaluationResult = {
  isCorrect: boolean;
  stepStatus: TutorStepStatus;
  detectedMistake: string | null;
  studentMessage: string;
  hint: string | null;
  annotations: TutorAnnotation[];
  nextExpectedStep: string | null;
};

export type TutorChatResult = {
  reply: string;
  suggestedActions: string[];
};

export type TutorStatusResult = {
  mode: 'deterministic' | 'external';
  provider: 'local' | 'openai_compatible';
  model: string | null;
  visionEnabled: boolean;
};
