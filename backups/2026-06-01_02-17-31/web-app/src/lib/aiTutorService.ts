export type TutorAnnotation = {
  type: 'circle' | 'underline' | 'write_text';
  targetText?: string | null;
  text?: string | null;
  color: 'red' | 'green';
};

export type TutorEvaluationRequest = {
  questionId?: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle?: string;
  recognizedText: string;
  recognizedLatex?: string | null;
  canvasImageBase64?: string | null;
  expectedAnswer?: string | null;
  expectedReasoning?: string | null;
};

export type TutorEvaluationResponse = {
  isCorrect: boolean;
  stepStatus: 'correct' | 'partially_correct' | 'incorrect' | 'unclear';
  detectedMistake: string | null;
  studentMessage: string;
  hint: string | null;
  annotations: TutorAnnotation[];
  nextExpectedStep: string | null;
};

export type TutorConversationMessage = {
  role: 'student' | 'tutor';
  content: string;
};

export type TutorChatRequest = {
  questionId?: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle?: string;
  recognizedText?: string | null;
  canvasImageBase64?: string | null;
  latestEvaluation?: TutorEvaluationResponse | null;
  message: string;
  conversation?: TutorConversationMessage[];
};

export type TutorChatResponse = {
  reply: string;
  suggestedActions: string[];
};

export type TutorStatusResponse = {
  mode: 'deterministic' | 'external';
  provider: 'local' | 'openai_compatible';
  model: string | null;
  visionEnabled: boolean;
};

function getAiTutorApiBase(): string {
  const explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, '') : '';
  return `${base}/api/ai-tutor`;
}

async function expectJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof (payload as { error?: unknown })?.error === 'string'
      ? (payload as { error: string }).error
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function evaluateStudentWork(input: TutorEvaluationRequest): Promise<TutorEvaluationResponse> {
  const response = await fetch(`${getAiTutorApiBase()}/evaluate-work`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return expectJson<TutorEvaluationResponse>(response);
}

export async function chatWithTutor(input: TutorChatRequest): Promise<TutorChatResponse> {
  const response = await fetch(`${getAiTutorApiBase()}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return expectJson<TutorChatResponse>(response);
}

export async function getTutorStatus(): Promise<TutorStatusResponse> {
  const response = await fetch(`${getAiTutorApiBase()}/status`);
  return expectJson<TutorStatusResponse>(response);
}
