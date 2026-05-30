import type { TutorChatInput, TutorChatResult, TutorEvaluationInput, TutorEvaluationResult } from './types';

export interface AiTutorExternalProvider {
  evaluateWork(input: TutorEvaluationInput): Promise<TutorEvaluationResult | null>;
  chat(input: TutorChatInput): Promise<TutorChatResult | null>;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export function getAiTutorProviderConfig() {
  const apiKey = (process.env['AI_TUTOR_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '').trim();
  const baseUrl = (process.env['AI_TUTOR_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = (process.env['AI_TUTOR_MODEL'] ?? 'gpt-4o-mini').trim();
  return { apiKey, baseUrl, model };
}

function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('AI tutor response was not JSON.');
  }
}

function asEvaluation(value: unknown): TutorEvaluationResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TutorEvaluationResult>;
  const status = record.stepStatus === 'correct' || record.stepStatus === 'partially_correct' || record.stepStatus === 'incorrect' || record.stepStatus === 'unclear'
    ? record.stepStatus
    : 'unclear';
  return {
    isCorrect: record.isCorrect === true,
    stepStatus: status,
    detectedMistake: typeof record.detectedMistake === 'string' ? record.detectedMistake : null,
    studentMessage: typeof record.studentMessage === 'string' ? record.studentMessage : 'I checked your work.',
    hint: typeof record.hint === 'string' ? record.hint : null,
    annotations: Array.isArray(record.annotations) ? record.annotations : [],
    nextExpectedStep: typeof record.nextExpectedStep === 'string' ? record.nextExpectedStep : null,
  };
}

function asChat(value: unknown): TutorChatResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TutorChatResult>;
  if (typeof record.reply !== 'string') return null;
  return {
    reply: record.reply,
    suggestedActions: Array.isArray(record.suggestedActions) ? record.suggestedActions.filter((entry): entry is string => typeof entry === 'string') : [],
  };
}

export class OpenAiCompatibleTutorProvider implements AiTutorExternalProvider {
  async completeJson(system: string, user: TutorEvaluationInput | TutorChatInput): Promise<unknown | null> {
    const { apiKey, baseUrl, model } = getAiTutorProviderConfig();
    if (!apiKey) return null;
    const { canvasImageBase64, ...textPayload } = user;
    const userContent: string | ChatContentPart[] = canvasImageBase64
      ? [
          { type: 'text', text: JSON.stringify(textPayload) },
          { type: 'image_url', image_url: { url: canvasImageBase64 } },
        ]
      : JSON.stringify(textPayload);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`External tutor failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('External tutor returned no content.');
    return extractJsonObject(content);
  }

  async evaluateWork(input: TutorEvaluationInput): Promise<TutorEvaluationResult | null> {
    const system = [
      'You are a strict but helpful math tutor for a student writing on a freehand workpad.',
      'Evaluate only the current step. Identify the first mathematical mistake only.',
      'Return strict JSON with keys: isCorrect, stepStatus, detectedMistake, studentMessage, hint, annotations, nextExpectedStep.',
      'annotations must be an array of objects with type circle|underline|write_text, optional targetText, optional text, and color red|green.',
    ].join(' ');
    const result = await this.completeJson(system, input);
    return asEvaluation(result);
  }

  async chat(input: TutorChatInput): Promise<TutorChatResult | null> {
    const system = [
      'You are a friendly AI math tutor chatting with a student.',
      'Use the current question, current step, recognized work, and latest evaluation.',
      'Be concise and guide the student without giving away too much unless asked.',
      'Return strict JSON with keys: reply and suggestedActions.',
    ].join(' ');
    const result = await this.completeJson(system, input);
    return asChat(result);
  }
}

export function getExternalAiTutorProvider(): AiTutorExternalProvider | null {
  const { apiKey } = getAiTutorProviderConfig();
  if (!apiKey) return null;
  return new OpenAiCompatibleTutorProvider();
}
