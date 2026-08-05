import type { HandwritingRecognitionInput, MyScriptInkInput, MyScriptInkStroke } from './types';

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

function parseCoordinateArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) {
    throw new Error(`${field} must contain between 1 and 10,000 points.`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(`${field} contains an invalid point.`);
    return entry;
  });
}

export function parseMyScriptInkInput(value: unknown): MyScriptInkInput {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid ink recognition payload.');
  const width = record.width;
  const height = record.height;
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 10_000) {
    throw new Error('width must be between 1 and 10,000.');
  }
  if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 20_000) {
    throw new Error('height must be between 1 and 20,000.');
  }
  if (!Array.isArray(record.strokes) || record.strokes.length === 0 || record.strokes.length > 250) {
    throw new Error('strokes must contain between 1 and 250 strokes.');
  }

  let totalPoints = 0;
  const strokes: MyScriptInkStroke[] = record.strokes.map((value, index) => {
    const stroke = asRecord(value);
    if (!stroke) throw new Error(`strokes[${index}] is invalid.`);
    const x = parseCoordinateArray(stroke.x, `strokes[${index}].x`);
    const y = parseCoordinateArray(stroke.y, `strokes[${index}].y`);
    const t = parseCoordinateArray(stroke.t, `strokes[${index}].t`);
    if (x.length !== y.length || x.length !== t.length) throw new Error(`strokes[${index}] point arrays must have equal lengths.`);
    totalPoints += x.length;
    return { x, y, t };
  });
  if (totalPoints > 50_000) throw new Error('Ink recognition is limited to 50,000 points per request.');
  return { width, height, strokes };
}
