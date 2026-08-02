import type { AiFeatureRequest, AiFeatureResult, AiFeatureTask } from './types';

type TaskConfig = {
  model: string;
  temperature: number;
  maxTokens: number;
  json: boolean;
};

const TASK_CONFIG: Record<AiFeatureTask, TaskConfig> = {
  test_generation: { model: 'llama-3.3-70b-versatile', temperature: 0.7, maxTokens: 2400, json: false },
  test_grading: { model: 'qwen/qwen3.6-27b', temperature: 0.1, maxTokens: 1000, json: true },
  feynman_format: { model: 'llama-3.1-8b-instant', temperature: 0.1, maxTokens: 400, json: false },
  feynman_feedback: { model: 'llama-3.3-70b-versatile', temperature: 0.3, maxTokens: 1200, json: false },
  study_sheet: { model: 'llama-3.3-70b-versatile', temperature: 0.3, maxTokens: 1800, json: true },
  subject_emoji: { model: 'llama-3.1-8b-instant', temperature: 0.5, maxTokens: 20, json: false },
  question_enrichment: { model: 'llama-3.3-70b-versatile', temperature: 0.1, maxTokens: 1800, json: true },
  question_classification: { model: 'llama-3.3-70b-versatile', temperature: 0.1, maxTokens: 2200, json: true },
};

export class AiFeatureProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter: string | null = null) {
    super(message);
    this.name = 'AiFeatureProviderError';
  }
}

export function getServerGroqKeys(): string[] {
  const serverKeys = (process.env['GROQ_API_KEY'] ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const migrationFallback = (process.env['VITE_GROQ_API_KEY'] ?? '').trim();
  return Array.from(new Set([...serverKeys, ...(serverKeys.length === 0 && migrationFallback ? [migrationFallback] : [])]));
}

export async function completeAiFeature(input: AiFeatureRequest): Promise<AiFeatureResult> {
  const keys = getServerGroqKeys();
  if (keys.length === 0) throw new AiFeatureProviderError('Groq is not configured on the API server.', 503);
  const config = TASK_CONFIG[input.task];

  for (let index = 0; index < keys.length; index += 1) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keys[index]}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        ...(config.json ? { response_format: { type: 'json_object' } } : {}),
        messages: input.messages,
      }),
    });

    if (response.ok) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new AiFeatureProviderError('The AI returned an empty response.', 502);
      return { content, model: payload.model ?? config.model };
    }

    // A revoked key can fail over to the next server-side key. Rate limits are
    // organization-wide, so rotating keys on 429 would only add wasted calls.
    if ((response.status === 401 || response.status === 403) && index < keys.length - 1) continue;
    const detail = (await response.text()).slice(0, 400);
    throw new AiFeatureProviderError(
      `Groq ${input.task} request failed (${response.status}): ${detail}`,
      response.status,
      response.headers.get('retry-after'),
    );
  }

  throw new AiFeatureProviderError('No configured Groq credential was accepted.', 502);
}
