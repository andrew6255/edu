import { fetchServiceRows } from '../../lib/supabaseServer';
import { freeformGradingService } from '../freeform-grading/service';

type AtomicInteraction =
  | { type: 'mcq'; choices: string[]; correctChoiceIndex: number }
  | { type: 'numeric'; correct: number | string | Array<number | string>; tolerance?: number }
  | { type: 'text'; accepted: string[]; trim?: boolean; caseSensitive?: boolean }
  | { type: 'line_equation'; forms: string[]; trim?: boolean; caseSensitive?: boolean }
  | { type: 'point_list'; points: Array<{ x: number; y: number }>; minPoints?: number; maxPoints?: number; ordered?: boolean }
  | { type: 'points_on_line'; lineForms: string[]; minPoints: number; maxPoints?: number; disallowGivenPoints?: Array<{ x: number; y: number }>; requireDistinct?: boolean }
  | { type: 'freeform'; grading: 'ai' | 'manual'; rubricSummary?: string | null };

type Interaction = AtomicInteraction | { type: 'composite'; final: AtomicInteraction };
export type ProgramAnswer =
  | { kind: 'mcq'; choiceIndex: number }
  | { kind: 'numeric'; valueText: string }
  | { kind: 'text'; valueText: string };
export type ProgramAnswerReveal = {
  solutionText: string | null;
  explanationScenes: Array<Record<string, unknown>>;
  stepExplanations: Array<{ id: string; title: string; explanation: string }>;
};
export type ServerGrade = {
  correct: boolean;
  correctIndex: number;
  status: 'graded' | 'pending_review';
  method: 'deterministic' | 'fallback';
  feedbackText?: string | null;
  reveal?: ProgramAnswerReveal;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseProgramAnswer(value: unknown): ProgramAnswer | null {
  const item = record(value);
  if (!item) return null;
  if (item.kind === 'mcq' && Number.isInteger(item.choiceIndex) && Number(item.choiceIndex) >= 0 && Number(item.choiceIndex) <= 100) {
    return { kind: 'mcq', choiceIndex: Number(item.choiceIndex) };
  }
  if ((item.kind === 'numeric' || item.kind === 'text') && typeof item.valueText === 'string' && item.valueText.length <= 2000) {
    return { kind: item.kind, valueText: item.valueText };
  }
  return null;
}

function normalizeText(value: string, trim: boolean, caseSensitive: boolean): string {
  const normalized = trim ? value.trim() : value;
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function parsePoints(value: string): Array<{ x: number; y: number }> {
  return Array.from(value.matchAll(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g))
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function parseLine(form: string): { verticalX?: number; m?: number; b?: number } | null {
  const normalized = form.replace(/\s+/g, '').toLowerCase();
  const vertical = normalized.match(/^x=([+-]?\d+(?:\.\d+)?)$/);
  if (vertical) return { verticalX: Number(vertical[1]) };
  const slope = normalized.match(/^y=([+-]?\d+(?:\.\d+)?)?x([+-]\d+(?:\.\d+)?)?$/);
  if (!slope) return null;
  const rawM = slope[1] ?? '1';
  const m = rawM === '+' || rawM === '' ? 1 : rawM === '-' ? -1 : Number(rawM);
  const b = Number(slope[2] ?? 0);
  return Number.isFinite(m) && Number.isFinite(b) ? { m, b } : null;
}

function canonicalLine(form: string, trim: boolean, caseSensitive: boolean): string {
  const normalized = normalizeText(form, trim, caseSensitive).replace(/\s+/g, '');
  const parsed = parseLine(normalized);
  if (!parsed || parsed.verticalX !== undefined) return normalized;
  return `y=${parsed.m}x${parsed.b! >= 0 ? `+${parsed.b}` : String(parsed.b)}`;
}

function pointOnLine(point: { x: number; y: number }, forms: string[]): boolean {
  return forms.some((form) => {
    const line = parseLine(form);
    if (!line) return false;
    if (line.verticalX !== undefined) return point.x === line.verticalX;
    return point.y === line.m! * point.x + line.b!;
  });
}

export function gradeProgramInteraction(interaction: Interaction, answer: ProgramAnswer): ServerGrade {
  const final = interaction.type === 'composite' ? interaction.final : interaction;
  const base = { correctIndex: 0, status: 'graded' as const, method: 'deterministic' as const };
  if (final.type === 'mcq' && answer.kind === 'mcq') {
    return { ...base, correct: answer.choiceIndex === final.correctChoiceIndex, correctIndex: final.correctChoiceIndex };
  }
  if (final.type === 'numeric' && answer.kind === 'numeric') {
    const submitted = Number(answer.valueText.trim());
    const tolerance = typeof final.tolerance === 'number' ? Math.max(0, final.tolerance) : 0;
    const expected = Array.isArray(final.correct) ? final.correct : [final.correct];
    const correct = answer.valueText.trim() !== '' && Number.isFinite(submitted) && expected.some((item) => {
      const target = Number(item);
      return Number.isFinite(target) && (tolerance > 0 ? Math.abs(submitted - target) <= tolerance : submitted === target);
    });
    return { ...base, correct };
  }
  if (final.type === 'text' && answer.kind === 'text') {
    const trim = final.trim !== false;
    const caseSensitive = final.caseSensitive === true;
    const submitted = normalizeText(answer.valueText, trim, caseSensitive);
    return { ...base, correct: final.accepted.some((item) => normalizeText(String(item), trim, caseSensitive) === submitted) };
  }
  if (final.type === 'line_equation' && answer.kind === 'text') {
    const trim = final.trim !== false;
    const caseSensitive = final.caseSensitive === true;
    const submitted = canonicalLine(answer.valueText, trim, caseSensitive);
    return { ...base, correct: final.forms.some((item) => canonicalLine(String(item), trim, caseSensitive) === submitted) };
  }
  if (final.type === 'point_list' && answer.kind === 'text') {
    const submitted = parsePoints(answer.valueText);
    const min = final.minPoints ?? final.points.length;
    const max = final.maxPoints ?? final.points.length;
    const correct = submitted.length >= min && submitted.length <= max && (final.ordered === true
      ? submitted.length === final.points.length && submitted.every((point, index) => !!final.points[index] && samePoint(point, final.points[index]!))
      : submitted.every((point) => final.points.some((expected) => samePoint(point, expected))));
    return { ...base, correct };
  }
  if (final.type === 'points_on_line' && answer.kind === 'text') {
    const submitted = parsePoints(answer.valueText);
    const min = final.minPoints ?? 1;
    const max = final.maxPoints ?? min;
    const distinct = new Set(submitted.map((point) => `${point.x},${point.y}`)).size === submitted.length;
    const disallowed = (final.disallowGivenPoints ?? []).some((given) => submitted.some((point) => samePoint(point, given)));
    return { ...base, correct: submitted.length >= min && submitted.length <= max && (final.requireDistinct === false || distinct) && !disallowed && submitted.every((point) => pointOnLine(point, final.lineForms)) };
  }
  if (final.type === 'freeform') {
    return { correct: false, correctIndex: 0, status: 'pending_review', method: 'fallback', feedbackText: 'This answer requires verified review.' };
  }
  return { ...base, correct: false, feedbackText: 'The submitted answer type does not match this question.' };
}

type ProgramRow = { question_banks_by_chapter?: unknown; annotations?: unknown };

function richText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const item = record(value);
  const raw = typeof item?.raw_text === 'string' ? item.raw_text.trim() : '';
  const latex = typeof item?.latex === 'string' ? item.latex.trim() : '';
  return raw || latex || null;
}

function buildReveal(annotation: Record<string, unknown> | null): ProgramAnswerReveal {
  const scenes = Array.isArray(annotation?.explanationScenes)
    ? annotation.explanationScenes.map(record).filter((item): item is Record<string, unknown> => !!item)
    : [];
  const steps = Array.isArray(annotation?.stepSolutions) ? annotation.stepSolutions : [];
  return {
    solutionText: richText(annotation?.solution),
    explanationScenes: scenes,
    stepExplanations: steps.map((value, index) => {
      const step = record(value);
      return {
        id: typeof step?.id === 'string' ? step.id : `step_${index + 1}`,
        title: typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : `Step ${index + 1}`,
        explanation: richText(step?.explanation) ?? '',
      };
    }).filter((step) => !!step.explanation),
  };
}

type LoadedPublishedQuestion = {
  interaction: Interaction;
  reveal: ProgramAnswerReveal;
  questionText: string;
  rubricSummary: string | null;
  hints: string[];
};

export async function loadPublishedQuestion(programId: string, questionId: string): Promise<LoadedPublishedQuestion> {
  const rows = await fetchServiceRows<ProgramRow>('public_programs', {
    select: 'question_banks_by_chapter,annotations', id: `eq.${programId}`, deleted_at: 'is.null', limit: '1',
  });
  const row = rows[0];
  if (!row) throw new Error('Published program not found');
  const banks = record(row.question_banks_by_chapter);
  const annotationsRoot = record(row.annotations);
  if (!banks) throw new Error('Published program has no question bank');

  for (const [chapterId, chapterValue] of Object.entries(banks)) {
    const chapter = record(chapterValue);
    const nodes = Array.isArray(chapter?.nodes) ? chapter.nodes : [];
    for (const nodeValue of nodes) {
      const node = record(nodeValue);
      const questions = Array.isArray(node?.questions) ? node.questions : [];
      for (const questionValue of questions) {
        const question = record(questionValue);
        const baseId = `${String(node?.node_id ?? '')}::${String(question?.question_id ?? '')}`;
        const parts = Array.isArray(question?.parts) ? question.parts : [];
        const matchedPart = parts.map(record).find((part) => questionId === `${baseId}::${String(part?.part_id ?? '')}`) ?? null;
        const exists = questionId === baseId || !!matchedPart;
        if (!exists) continue;
        const chapterAnnotations = record(record(record(annotationsRoot?.chapters)?.[chapterId])?.annotations);
        const annotation = record(chapterAnnotations?.[questionId]) ?? record(chapterAnnotations?.[baseId]);
        const interaction = record(annotation?.interaction);
        const reveal = buildReveal(annotation);
        const prompt = [richText(question?.raw_text) ?? richText(question?.latex), richText(matchedPart?.raw_text) ?? richText(matchedPart?.latex)]
          .filter((value): value is string => !!value).join('\n');
        const hints = Array.isArray(annotation?.hints)
          ? annotation.hints.map(richText).filter((value): value is string => !!value)
          : [];
        const loaded = (resolvedInteraction: Interaction): LoadedPublishedQuestion => {
          const final = resolvedInteraction.type === 'composite' ? resolvedInteraction.final : resolvedInteraction;
          return {
            interaction: resolvedInteraction,
            reveal,
            questionText: prompt || 'Published program question',
            rubricSummary: final.type === 'freeform' && typeof final.rubricSummary === 'string' ? final.rubricSummary : null,
            hints,
          };
        };
        if (interaction?.type === 'composite') {
          const final = record(interaction.final);
          if (final?.type) return loaded({ type: 'composite', final: final as AtomicInteraction });
        }
        if (interaction?.type) return loaded(interaction as AtomicInteraction);
        const mcq = record(annotation?.mcq);
        if (Array.isArray(mcq?.choices) && Number.isInteger(mcq.correctChoiceIndex)) {
          return loaded({ type: 'mcq', choices: mcq.choices.map(String), correctChoiceIndex: Number(mcq.correctChoiceIndex) });
        }
        throw new Error('Question does not have a deterministic published interaction');
      }
    }
  }
  throw new Error('Question is not part of this published program');
}

export async function loadPublishedInteraction(programId: string, questionId: string): Promise<Interaction> {
  return (await loadPublishedQuestion(programId, questionId)).interaction;
}

export async function gradePublishedQuestion(
  programId: string,
  questionId: string,
  answer: ProgramAnswer,
  options?: { gradeFreeform?: boolean },
): Promise<ServerGrade> {
  const question = await loadPublishedQuestion(programId, questionId);
  const final = question.interaction.type === 'composite' ? question.interaction.final : question.interaction;
  if (final.type === 'freeform') {
    if (options?.gradeFreeform !== true) {
      return { ...gradeProgramInteraction(question.interaction, answer), reveal: question.reveal };
    }
    if (answer.kind !== 'text') {
      return { correct: false, correctIndex: 0, status: 'graded', method: 'fallback', feedbackText: 'The submitted answer type does not match this question.', reveal: question.reveal };
    }
    const result = await freeformGradingService.grade({
      questionText: question.questionText,
      answerText: answer.valueText,
      grading: final.grading,
      rubricSummary: question.rubricSummary,
      solutionText: question.reveal.solutionText,
      hints: question.hints,
      stepValues: null,
    });
    return { ...result, reveal: question.reveal };
  }
  return { ...gradeProgramInteraction(question.interaction, answer), reveal: question.reveal };
}
