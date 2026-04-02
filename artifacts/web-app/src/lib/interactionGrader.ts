type InteractionLike =
  | { type: 'mcq'; choices: string[]; correctChoiceIndex: number }
  | { type: 'numeric'; correct: number | string | Array<number | string>; tolerance?: number }
  | { type: 'text'; accepted: string[]; trim?: boolean; caseSensitive?: boolean };

export function gradeInteraction(
  interaction: InteractionLike | null,
  answer: { kind: 'mcq'; choiceIndex: number } | { kind: 'numeric'; valueText: string } | { kind: 'text'; valueText: string }
): { correct: boolean; correctIndex: number } {
  if (!interaction) return { correct: false, correctIndex: 0 };
  if (interaction.type === 'mcq' && answer.kind === 'mcq') {
    const correctIndex = interaction.correctChoiceIndex;
    return { correct: answer.choiceIndex === correctIndex, correctIndex };
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
    return { correct: ok, correctIndex: 0 };
  }
  if (interaction.type === 'text' && answer.kind === 'text') {
    const trim = interaction.trim !== false;
    const caseSensitive = interaction.caseSensitive === true;
    const v0 = String(answer.valueText ?? '');
    const v1 = trim ? v0.trim() : v0;
    const v = caseSensitive ? v1 : v1.toLowerCase();
    const accepted: string[] = Array.isArray(interaction.accepted) ? interaction.accepted.map((x) => String(x)) : [];
    const ok = accepted.some((a: string) => {
      const a0 = String(a ?? '');
      const a1 = trim ? a0.trim() : a0;
      const aa = caseSensitive ? a1 : a1.toLowerCase();
      return aa === v;
    });
    return { correct: ok, correctIndex: 0 };
  }
  return { correct: false, correctIndex: 0 };
}
