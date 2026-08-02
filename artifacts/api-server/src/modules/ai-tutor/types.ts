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

export type TutorAnswerPackage = {
  modelAnswer: string;
  highLevelSteps: string[];
  fullSolution: Array<{ title: string; body: string }>;
  gradingRubric: Array<{ criterion: string; points: number }>;
  provenance: 'source' | 'ai_generated';
  reviewStatus: 'approved' | 'pending_review';
  generatedAt?: string | null;
  model?: string | null;
};

export type TutorAnswerRequest = {
  programId?: string;
  questionId: string;
  questionPrompt: string;
  existingAnswer?: string | null;
};

export type TutorPaperHelpMode = 'steps' | 'next_step' | 'solve';

export type TutorPaperHelpRequest = {
  mode: TutorPaperHelpMode;
  programId?: string;
  questionId: string;
  questionPrompt: string;
  subQuestionId?: string | null;
  subQuestionPrompt?: string | null;
  recognizedWork?: string | null;
  answerPackage?: TutorAnswerPackage | null;
};

export type TutorPaperHelpResult = {
  mode: TutorPaperHelpMode;
  steps: Array<{ title: string; body?: string | null }>;
  answerPackage: TutorAnswerPackage;
};

export type TutorPaperGradeRequest = {
  questionId: string;
  questionPrompt: string;
  assisted: boolean;
  answerPackage?: TutorAnswerPackage | null;
  parts: Array<{
    id: string;
    prompt: string;
    recognizedWork: string;
    hasStudentWork: boolean;
  }>;
};

export type TutorPaperGradeResult = {
  score: number;
  totalPoints: number;
  assisted: boolean;
  feedback: string;
  parts: Array<{
    id: string;
    score: number;
    maxPoints: number;
    feedback: string;
    unanswered: boolean;
  }>;
};
