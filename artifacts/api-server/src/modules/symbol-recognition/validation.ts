import type { SymbolRecognitionInput } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseSymbolRecognitionInput(value: unknown): SymbolRecognitionInput {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid symbol recognition payload.');

  const imageBase64 = typeof record.imageBase64 === 'string' ? record.imageBase64.trim() : '';
  if (!imageBase64) throw new Error('imageBase64 is required.');

  let allowedSymbols: string[] | undefined;
  if (Array.isArray(record.allowedSymbols)) {
    allowedSymbols = record.allowedSymbols
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .map((entry) => entry.slice(0, 1));
    if (allowedSymbols.length === 0) allowedSymbols = undefined;
  }

  return allowedSymbols ? { imageBase64, allowedSymbols } : { imageBase64 };
}
