import type { AiFeatureContentPart, AiFeatureMessage, AiFeatureRequest, AiFeatureTask } from './types';

const TASKS = new Set<AiFeatureTask>([
  'test_generation',
  'test_grading',
  'feynman_format',
  'feynman_feedback',
  'study_sheet',
  'subject_emoji',
  'question_enrichment',
  'question_classification',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseContentPart(value: unknown): AiFeatureContentPart {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid AI feature content part.');
  if (record.type === 'text' && typeof record.text === 'string' && record.text.trim()) {
    if (record.text.length > 50_000) throw new Error('AI feature text part is too long.');
    return { type: 'text', text: record.text };
  }
  const image = asRecord(record.image_url);
  if (record.type === 'image_url' && image && typeof image.url === 'string') {
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image.url)) {
      throw new Error('Only embedded PNG, JPEG, or WebP images are accepted.');
    }
    if (image.url.length > 5_000_000) throw new Error('AI feature image is too large.');
    return { type: 'image_url', image_url: { url: image.url } };
  }
  throw new Error('Unsupported AI feature content part.');
}

function parseMessage(value: unknown): AiFeatureMessage {
  const record = asRecord(value);
  if (!record || (record.role !== 'system' && record.role !== 'user' && record.role !== 'assistant')) {
    throw new Error('Invalid AI feature message role.');
  }
  if (typeof record.content === 'string') {
    if (!record.content.trim()) throw new Error('AI feature message content is required.');
    if (record.content.length > 50_000) throw new Error('AI feature message is too long.');
    return { role: record.role, content: record.content };
  }
  if (Array.isArray(record.content) && record.content.length > 0 && record.content.length <= 12) {
    return { role: record.role, content: record.content.map(parseContentPart) };
  }
  throw new Error('Invalid AI feature message content.');
}

export function parseAiFeatureRequest(value: unknown): AiFeatureRequest {
  const record = asRecord(value);
  if (!record || typeof record.task !== 'string' || !TASKS.has(record.task as AiFeatureTask)) {
    throw new Error('Unsupported AI feature task.');
  }
  if (!Array.isArray(record.messages) || record.messages.length === 0 || record.messages.length > 12) {
    throw new Error('AI feature messages must contain between 1 and 12 entries.');
  }
  const messages = record.messages.map(parseMessage);
  const encodedSize = JSON.stringify(messages).length;
  if (encodedSize > 15_000_000) throw new Error('AI feature request is too large.');
  return { task: record.task as AiFeatureTask, messages };
}
