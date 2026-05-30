import type { HandwritingRecognitionInput } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseHandwritingRecognitionInput(value: unknown): HandwritingRecognitionInput {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid handwriting recognition payload.');

  const imageBase64 = typeof record.imageBase64 === 'string' ? record.imageBase64.trim() : '';
  if (!imageBase64) throw new Error('imageBase64 is required.');

  const preferredOutput = record.preferredOutput === 'latex' ? 'latex' : 'text';
  const contextHint = typeof record.contextHint === 'string' && record.contextHint.trim().length > 0
    ? record.contextHint.trim()
    : null;

  return {
    imageBase64,
    preferredOutput,
    contextHint,
  };
}
