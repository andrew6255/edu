type AtomicInteractionLike =
  | { type: 'mcq'; choices: string[]; correctChoiceIndex: number }
  | { type: 'numeric'; correct: number | string | Array<number | string>; tolerance?: number }
  | { type: 'text'; accepted: string[]; trim?: boolean; caseSensitive?: boolean }
  | { type: 'line_equation'; forms: string[]; variable?: string; trim?: boolean; caseSensitive?: boolean }
  | { type: 'point_list'; points: Array<{ x: number; y: number }>; minPoints?: number; maxPoints?: number; ordered?: boolean; allowEquivalentOrder?: boolean }
  | { type: 'points_on_line'; lineForms: string[]; minPoints: number; maxPoints?: number; disallowGivenPoints?: Array<{ x: number; y: number }>; requireDistinct?: boolean }
  | { type: 'freeform'; grading: 'ai' | 'manual'; placeholder?: string; rubricSummary?: string | null; acceptSteps?: boolean };

type FreeformAnswer = { kind: 'numeric'; valueText: string } | { kind: 'text'; valueText: string };

function normalizeText(value: string, trim: boolean, caseSensitive: boolean): string {
  const v1 = trim ? value.trim() : value;
  return caseSensitive ? v1 : v1.toLowerCase();
}

function parsePointList(valueText: string): Array<{ x: number; y: number }> {
  const matches = Array.from(valueText.matchAll(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g));
  return matches
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function parseSlopeIntercept(form: string): { m: number; b: number } | null {
  const normalized = form.replace(/\s+/g, '').toLowerCase();
  const match = normalized.match(/^y=([+-]?\d+(?:\.\d+)?)?x([+-]\d+(?:\.\d+)?)?$/);
  if (!match) return null;
  const mRaw = match[1] ?? '1';
  const bRaw = match[2] ?? '0';
  const m = mRaw === '+' || mRaw === '' ? 1 : (mRaw === '-' ? -1 : Number(mRaw));
  const b = Number(bRaw || 0);
  return Number.isFinite(m) && Number.isFinite(b) ? { m, b } : null;
}

function canonicalizeLineEquation(form: string, trim: boolean, caseSensitive: boolean): string {
  const normalized = normalizeText(String(form ?? ''), trim, caseSensitive).replace(/\s+/g, '');
  const parsed = parseSlopeIntercept(normalized);
  if (parsed) {
    return `y=${parsed.m}x${parsed.b >= 0 ? `+${parsed.b}` : `${parsed.b}`}`;
  }
  return normalized;
}

function pointSatisfiesLine(point: { x: number; y: number }, lineForms: string[]): boolean {
  return lineForms.some((form) => {
    if (/^x=/.test(form.replace(/\s+/g, '').toLowerCase())) {
      const x = Number(form.replace(/\s+/g, '').slice(2));
      return Number.isFinite(x) && point.x === x;
    }
    const parsed = parseSlopeIntercept(form);
    return !!parsed && point.y === parsed.m * point.x + parsed.b;
  });
}

type InteractionLike =
  | AtomicInteractionLike
  | {
      type: 'composite';
      final: AtomicInteractionLike;
      steps: Array<unknown>;
      allowDirectFinalAnswer?: boolean;
      scoreStrategy?: 'final_only' | 'final_plus_steps';
    };

export type InteractionGradeResult = {
  correct: boolean;
  correctIndex: number;
  status?: 'graded' | 'pending_review';
  method?: 'deterministic' | 'fallback';
  feedbackText?: string | null;
};

function gradeAtomicInteraction(
  interaction: AtomicInteractionLike | null,
  answer: { kind: 'mcq'; choiceIndex: number } | FreeformAnswer
): InteractionGradeResult {
  if (!interaction) return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };
  if (interaction.type === 'mcq' && answer.kind === 'mcq') {
    const correctIndex = interaction.correctChoiceIndex;
    return { correct: answer.choiceIndex === correctIndex, correctIndex, status: 'graded', method: 'deterministic' };
  }
  if (interaction.type === 'numeric' && answer.kind === 'numeric') {
    const raw = String(answer.valueText ?? '').trim();
    const parsed = raw === '' ? NaN : Number(raw);
    const tol = typeof interaction.tolerance === 'number' ? interaction.tolerance : 0;
    const corrects: Array<string | number> = Array.isArray(interaction.correct) ? interaction.correct : [interaction.correct];
    const ok =
      Number.isFinite(parsed) &&
      corrects.some((c: string | number) => {
        const cc = Number(c);
        if (!Number.isFinite(cc)) return false;
        return tol > 0 ? Math.abs(parsed - cc) <= tol : parsed === cc;
      });
    return { correct: ok, correctIndex: 0, status: 'graded', method: 'deterministic' };
  }
  if (interaction.type === 'text' && answer.kind === 'text') {
    const trim = interaction.trim !== false;
    const caseSensitive = interaction.caseSensitive === true;
    const v0 = String(answer.valueText ?? '');
    const v = normalizeText(v0, trim, caseSensitive);
    const accepted: string[] = Array.isArray(interaction.accepted) ? interaction.accepted.map((x) => String(x)) : [];
    const ok = accepted.some((a: string) => {
      const aa = normalizeText(String(a ?? ''), trim, caseSensitive);
      return aa === v;
    });
    return { correct: ok, correctIndex: 0, status: 'graded', method: 'deterministic' };
  }
  if (interaction.type === 'line_equation' && answer.kind === 'text') {
    const trim = interaction.trim !== false;
    const caseSensitive = interaction.caseSensitive === true;
    const submitted = canonicalizeLineEquation(String(answer.valueText ?? ''), trim, caseSensitive);
    const ok = (Array.isArray(interaction.forms) ? interaction.forms : [])
      .map((form) => canonicalizeLineEquation(String(form ?? ''), trim, caseSensitive))
      .some((form) => form === submitted);
    return { correct: ok, correctIndex: 0, status: 'graded', method: 'deterministic' };
  }
  if (interaction.type === 'point_list' && answer.kind === 'text') {
    const parsed = parsePointList(String(answer.valueText ?? ''));
    const minPoints = typeof interaction.minPoints === 'number' ? interaction.minPoints : interaction.points.length;
    const maxPoints = typeof interaction.maxPoints === 'number' ? interaction.maxPoints : interaction.points.length;
    if (parsed.length < minPoints || parsed.length > maxPoints) return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };

    const expected = Array.isArray(interaction.points) ? interaction.points : [];
    const ordered = interaction.ordered === true;
    const ok = ordered
      ? parsed.length === expected.length && parsed.every((point, idx) => !!expected[idx] && samePoint(point, expected[idx]!))
      : parsed.every((point) => expected.some((target) => samePoint(point, target)));
    return { correct: ok, correctIndex: 0, status: 'graded', method: 'deterministic' };
  }
  if (interaction.type === 'points_on_line' && answer.kind === 'text') {
    const parsed = parsePointList(String(answer.valueText ?? ''));
    const minPoints = typeof interaction.minPoints === 'number' ? interaction.minPoints : 1;
    const maxPoints = typeof interaction.maxPoints === 'number' ? interaction.maxPoints : minPoints;
    if (parsed.length < minPoints || parsed.length > maxPoints) return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };
    if (interaction.requireDistinct !== false) {
      const keys = new Set(parsed.map((point) => `${point.x},${point.y}`));
      if (keys.size !== parsed.length) return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };
    }
    if (Array.isArray(interaction.disallowGivenPoints) && interaction.disallowGivenPoints.some((given) => parsed.some((point) => samePoint(point, given)))) {
      return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };
    }
    const ok = parsed.every((point) => pointSatisfiesLine(point, interaction.lineForms));
    return { correct: ok, correctIndex: 0, status: 'graded', method: 'deterministic' };
  }
  if (interaction.type === 'freeform' && answer.kind === 'text') {
    const hasAnswer = String(answer.valueText ?? '').trim().length > 0;
    return {
      correct: false,
      correctIndex: 0,
      status: hasAnswer ? 'pending_review' : 'graded',
      method: 'fallback',
      feedbackText: hasAnswer
        ? (interaction.grading === 'ai' ? 'This answer will use AI-assisted review.' : 'This answer needs teacher/manual review.')
        : 'Enter an answer to continue.',
    };
  }
  return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };
}

export function gradeInteraction(
  interaction: InteractionLike | null,
  answer: { kind: 'mcq'; choiceIndex: number } | FreeformAnswer
): InteractionGradeResult {
  if (!interaction) return { correct: false, correctIndex: 0, status: 'graded', method: 'deterministic' };
  if (interaction.type === 'composite') {
    return gradeAtomicInteraction(interaction.final, answer);
  }
  return gradeAtomicInteraction(interaction, answer);
}
