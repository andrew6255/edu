import { requireSupabase } from '@/lib/supabase';

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

export type BuilderAnswerPackage = {
  modelAnswer: string | null;
  solution: string | null;
  solutionPlan: string | null;
  gradingSchema: Array<{ criterion: string; points: number }> | null;
  aiTutorNotes: string | null;
  answerProvenance: 'source' | 'embedded_source' | 'ai_generated' | 'missing' | null;
  answerReviewStatus: 'approved' | 'pending_review' | null;
};

/**
 * Published programs ship without answer keys (public_programs_sanitized strips
 * them from builder_spec), so the authored answer for a single question is
 * fetched from the authenticated economy endpoint instead.
 */
export async function fetchPublicProgramAnswer(input: {
  programId: string;
  chapterId: string;
  questionTypeId: string;
  questionId: string;
}): Promise<BuilderAnswerPackage> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required.');
  const base = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/+$/, '') || '';
  const response = await fetch(`${base}/api/economy/program-answer-reveal`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as { answer?: BuilderAnswerPackage; error?: string };
  if (!response.ok || !payload.answer) {
    throw new Error(payload.error || 'Could not load the answer for this question.');
  }
  return payload.answer;
}

export function toTutorAnswerPackage(answer: BuilderAnswerPackage): TutorAnswerPackage {
  const modelAnswer = answer.modelAnswer || answer.solution || '';
  if (!modelAnswer) throw new Error('This question does not have an authored answer yet.');
  const highLevelSteps = (answer.solutionPlan ?? '')
    .split(/\r?\n/)
    .map(step => step.replace(/^[•*-]\s*/, '').trim())
    .filter(Boolean);
  return {
    modelAnswer,
    highLevelSteps,
    fullSolution: [{ title: 'Solution', body: answer.solution || modelAnswer }],
    gradingRubric: answer.gradingSchema?.length
      ? answer.gradingSchema.map(item => ({ criterion: item.criterion, points: item.points }))
      : [{ criterion: 'Correct method and answer', points: 100 }],
    provenance: answer.answerProvenance === 'ai_generated' ? 'ai_generated' : 'source',
    reviewStatus: answer.answerReviewStatus === 'pending_review' ? 'pending_review' : 'approved',
  };
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
