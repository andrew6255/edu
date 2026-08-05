import { describe, expect, it } from 'vitest';
import { gradeProgramInteraction, parseProgramAnswer } from './programGrading';

describe('server program grading', () => {
  it('grades MCQ answers without accepting a correctness flag', () => {
    const answer = parseProgramAnswer({ kind: 'mcq', choiceIndex: 2, correct: true });
    expect(answer).toEqual({ kind: 'mcq', choiceIndex: 2 });
    expect(gradeProgramInteraction({ type: 'mcq', choices: ['a', 'b', 'c'], correctChoiceIndex: 1 }, answer!)).toMatchObject({
      correct: false,
      correctIndex: 1,
      status: 'graded',
    });
  });

  it('honors numeric tolerances', () => {
    expect(gradeProgramInteraction(
      { type: 'numeric', correct: 3.14, tolerance: 0.01 },
      { kind: 'numeric', valueText: '3.145' },
    ).correct).toBe(true);
  });

  it('normalizes configured text answers', () => {
    expect(gradeProgramInteraction(
      { type: 'text', accepted: ['Cairo'], trim: true, caseSensitive: false },
      { kind: 'text', valueText: ' cairo ' },
    ).correct).toBe(true);
  });

  it('supports equivalent slope-intercept formatting', () => {
    expect(gradeProgramInteraction(
      { type: 'line_equation', forms: ['y=2x+3'] },
      { kind: 'text', valueText: ' y = 2x + 3 ' },
    ).correct).toBe(true);
  });

  it('does not automatically reward AI or manually graded freeform work', () => {
    expect(gradeProgramInteraction(
      { type: 'freeform', grading: 'ai' },
      { kind: 'text', valueText: 'A detailed response' },
    )).toMatchObject({ correct: false, status: 'pending_review' });
  });

  it('rejects oversized and malformed submissions', () => {
    expect(parseProgramAnswer({ kind: 'mcq', choiceIndex: -1 })).toBeNull();
    expect(parseProgramAnswer({ kind: 'text', valueText: 'x'.repeat(2001) })).toBeNull();
    expect(parseProgramAnswer({ correct: true })).toBeNull();
  });
});
