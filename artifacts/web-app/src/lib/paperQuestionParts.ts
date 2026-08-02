import type { PersonalProgramQuestion } from '@/lib/personalProgramService';

export type PaperQuestionPart = { id: string; label: string; prompt: string };
export type PaperQuestionShape = { context: string; parts: PaperQuestionPart[] };

function parseNumberedParts(rawText: string, questionId: string): PaperQuestionShape | null {
  const pattern = /(?:^|\n)\s*((?:\d+|[A-Z]))[.)]\s*/g;
  const matches = [...rawText.matchAll(pattern)];
  if (matches.length < 2) return null;
  const context = rawText.slice(0, matches[0].index ?? 0).trim();
  const parts = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? rawText.length : rawText.length;
    return { id: `${questionId}:parsed:${index}`, label: `${match[1]})`, prompt: rawText.slice(start, end).trim() };
  }).filter(part => part.prompt);
  return parts.length >= 2 ? { context, parts } : null;
}

export function buildPaperQuestionShape(question?: PersonalProgramQuestion | string): PaperQuestionShape {
  const objectQuestion = typeof question === 'string' ? null : question;
  const questionId = objectQuestion?.id || 'question';
  const explicitParts = objectQuestion?.subQuestions?.filter(sub => sub.rawText?.trim()) ?? [];
  if (explicitParts.length > 0) {
    const raw = objectQuestion?.rawText || '';
    const firstPart = explicitParts[0]?.rawText || '';
    const inferredContext = firstPart && raw.includes(firstPart) ? raw.slice(0, raw.indexOf(firstPart)).trim() : raw;
    return {
      context: objectQuestion?.context || inferredContext,
      parts: explicitParts.map((part, index) => ({ id: `${questionId}:sub:${index}`, label: part.label || `${index + 1})`, prompt: part.rawText })),
    };
  }
  const prompt = typeof question === 'string' ? question : objectQuestion?.context || objectQuestion?.rawText || objectQuestion?.promptBlocks?.[0]?.text || '';
  return parseNumberedParts(prompt, questionId) ?? { context: '', parts: [{ id: `${questionId}:main`, label: '', prompt }] };
}

