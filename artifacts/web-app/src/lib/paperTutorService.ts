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

export type PaperHelpMode = 'steps' | 'hint' | 'solve';

export type PaperHelpResult = {
  mode: PaperHelpMode;
  steps: Array<{ title: string; body?: string | null }>;
  answerPackage: TutorAnswerPackage;
};

export type PaperGradeResult = {
  score: number;
  totalPoints: number;
  assisted: boolean;
  feedback: string;
  parts: Array<{ id: string; score: number; maxPoints: number; feedback: string; unanswered: boolean }>;
};

export type PaperCorrectionResult = {
  isCorrect: boolean;
  stepStatus: 'correct' | 'partially_correct' | 'incorrect' | 'unclear';
  detectedMistake: string | null;
  studentMessage: string;
  hint: string | null;
  annotations: Array<{
    type: 'circle' | 'underline' | 'write_text';
    targetText?: string | null;
    text?: string | null;
    color: 'red' | 'green';
  }>;
  nextExpectedStep: string | null;
};

function apiBase(): string {
  let explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  if (explicit && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    explicit = explicit.replace('localhost', window.location.hostname);
  }
  return `${explicit?.replace(/\/+$/, '') || ''}/api/ai-tutor`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = apiBase();
  const requestUrl = `${base}${path}`;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const apiOrigin = base.replace(/\/api\/ai-tutor$/, '') || window.location.origin;
    throw new Error(`The local AI API is not running at ${apiOrigin}. Start the project from its root with "npm run dev", wait for both servers to report ready, then try again.`, { cause });
  }
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`The AI tutor service returned an invalid response (${response.status}).`); }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `AI tutor request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

export function generateTutorAnswer(input: {
  programId?: string;
  questionId: string;
  questionPrompt: string;
  existingAnswer?: string | null;
}): Promise<TutorAnswerPackage> {
  return postJson('/generate-answer', input);
}

export function findTutorAnswer(input: {
  programId?: string;
  questionId: string;
  questionPrompt: string;
  existingAnswer?: string | null;
}): Promise<{ answer: TutorAnswerPackage | null }> {
  return postJson('/find-answer', input);
}

export function requestPaperHelp(input: {
  mode: PaperHelpMode;
  programId?: string;
  questionId: string;
  questionPrompt: string;
  subQuestionId?: string | null;
  subQuestionPrompt?: string | null;
  recognizedWork?: string | null;
  answerPackage?: TutorAnswerPackage | null;
}): Promise<PaperHelpResult> {
  return postJson('/paper-help', input);
}

export function evaluatePaperWork(input: {
  questionId: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle?: string;
  recognizedText: string;
  recognizedLatex?: string | null;
  expectedAnswer?: string | null;
  expectedReasoning?: string | null;
}): Promise<PaperCorrectionResult> {
  return postJson('/evaluate-work', input);
}

export function gradeTutorPaper(input: {
  questionId: string;
  questionPrompt: string;
  assisted: boolean;
  answerPackage?: TutorAnswerPackage | null;
  parts: Array<{ id: string; prompt: string; recognizedWork: string; hasStudentWork: boolean }>;
}): Promise<PaperGradeResult> {
  return postJson('/grade-paper', input);
}

export function explainPaperCorrection(input: {
  questionId: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle?: string;
  recognizedText?: string | null;
  message: string;
  conversation?: Array<{ role: 'student' | 'tutor'; content: string }>;
}): Promise<{ reply: string; suggestedActions: string[] }> {
  return postJson('/chat', input);
}
