export type AiFeatureTask =
  | 'test_generation'
  | 'test_grading'
  | 'feynman_format'
  | 'feynman_feedback'
  | 'study_sheet'
  | 'subject_emoji'
  | 'question_enrichment'
  | 'question_classification';

export type AiFeatureMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

export class AiFeatureRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds: number | null) {
    super(message);
    this.name = 'AiFeatureRequestError';
  }
}

function apiUrl(): string {
  let explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  if (explicit && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    explicit = explicit.replace('localhost', window.location.hostname);
  }
  return `${explicit?.replace(/\/+$/, '') || ''}/api/ai-features/complete`;
}

export async function completeAiFeature(input: {
  task: AiFeatureTask;
  messages: AiFeatureMessage[];
}): Promise<{ content: string; model: string }> {
  let response: Response;
  try {
    response = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    const error = new AiFeatureRequestError('The local AI API is not running. Start the project from its root with "npm run dev".', 0, null);
    error.cause = cause;
    throw error;
  }

  const text = await response.text();
  let payload: { content?: unknown; model?: unknown; error?: unknown } = {};
  try { payload = text ? JSON.parse(text) as typeof payload : {}; }
  catch { throw new AiFeatureRequestError(`The AI feature service returned an invalid response (${response.status}).`, response.status, null); }

  if (!response.ok) {
    const retryHeader = Number(response.headers.get('retry-after'));
    throw new AiFeatureRequestError(
      typeof payload.error === 'string' ? payload.error : `AI feature request failed (${response.status}).`,
      response.status,
      Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null,
    );
  }
  if (typeof payload.content !== 'string' || !payload.content.trim()) {
    throw new AiFeatureRequestError('The AI feature service returned no content.', 502, null);
  }
  return { content: payload.content, model: typeof payload.model === 'string' ? payload.model : 'unknown' };
}
