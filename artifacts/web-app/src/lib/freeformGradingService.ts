import type { InteractionGradeResult } from '@/lib/interactionGrader';

export type FreeformGradingDetails = {
  decision: string;
  strengths: string[];
  issues: string[];
  nextStep: string | null;
  confidence: 'low' | 'medium' | 'high';
};

export type FreeformGradingRequest = {
  questionText: string;
  answerText: string;
  grading: 'ai' | 'manual';
  rubricSummary?: string | null;
  solutionText?: string | null;
  hints?: string[];
  stepValues?: Record<string, string> | null;
};

export type FreeformGradingResponse = InteractionGradeResult & {
  provider?: string;
  details?: FreeformGradingDetails | null;
};

function buildFeedbackFromDetails(details: FreeformGradingDetails | null | undefined, fallback: string | null | undefined): string | null {
  if (!details) return fallback ?? null;
  const parts: string[] = [];
  if (details.decision) parts.push(details.decision);
  if (details.strengths.length > 0) parts.push(`Strengths: ${details.strengths.join('; ')}`);
  if (details.issues.length > 0) parts.push(`Issues: ${details.issues.join('; ')}`);
  if (details.nextStep) parts.push(`Next step: ${details.nextStep}`);
  return parts.length > 0 ? parts.join('\n') : (fallback ?? null);
}

function getFreeformGradingApiBase(): string {
  const explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, '') : '';
  return `${base}/api/freeform-grading`;
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

export async function gradeFreeformAnswer(input: FreeformGradingRequest): Promise<FreeformGradingResponse> {
  const response = await fetch(`${getFreeformGradingApiBase()}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await expectJson<FreeformGradingResponse>(response);
  return {
    ...payload,
    feedbackText: buildFeedbackFromDetails(payload.details, payload.feedbackText),
  };
}
