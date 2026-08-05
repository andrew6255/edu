import { describe, expect, it } from 'vitest';
import { sanitizeBuilderSpec, sanitizeInteraction, sanitizeQuestion } from './programBuilderSpec';

describe('builder spec sanitization', () => {
  it('removes every answer-bearing field from a question', () => {
    const question = sanitizeQuestion({
      id: 'q1', question: 'Solve 2x+3=11', promptBlocks: [{ type: 'text', text: 'Solve' }],
      options: ['3', '4'], difficulty: 'easy', hint: 'Isolate x',
      modelAnswer: 'x=4', rawAnswerText: 'x=4', answerFromPdf: true, solution: 'Subtract 3',
      solutionPlan: 'Subtract\nDivide', gradingSchema: [{ criterion: 'Method', points: 50 }],
      explanationScenes: [{ afterText: 'x=4' }], stepSolutions: [{ id: 's1' }],
      answerProvenance: 'source', answerReviewStatus: 'approved', aiTutorNotes: 'watch signs',
      correct_option_index: 1,
    }) as Record<string, unknown>;

    expect(Object.keys(question).sort()).toEqual(['difficulty', 'hint', 'id', 'options', 'promptBlocks', 'question']);
  });

  it('blanks the correct choice without dropping the choices', () => {
    expect(sanitizeInteraction({ type: 'mcq', choices: ['a', 'b'], correctChoiceIndex: 1 }))
      .toEqual({ type: 'mcq', choices: ['a', 'b'], correctChoiceIndex: -1 });
  });

  it('blanks each interaction type in place', () => {
    expect(sanitizeInteraction({ type: 'numeric', correct: 42, tolerance: 0.1 }))
      .toEqual({ type: 'numeric', correct: null, tolerance: 0.1 });
    expect(sanitizeInteraction({ type: 'text', accepted: ['Cairo'] })).toEqual({ type: 'text', accepted: [] });
    expect(sanitizeInteraction({ type: 'line_equation', forms: ['y=2x'] })).toEqual({ type: 'line_equation', forms: [] });
    expect(sanitizeInteraction({ type: 'point_list', points: [{ x: 1, y: 2 }] }))
      .toEqual({ type: 'point_list', points: [], minPoints: 1, maxPoints: 1 });
  });

  it('recurses into composite steps and drops their explanations', () => {
    const result = sanitizeInteraction({
      type: 'composite',
      final: { type: 'mcq', choices: ['a', 'b'], correctChoiceIndex: 0 },
      steps: [{ id: 's1', title: 'Step', explanation: 'secret', interaction: { type: 'numeric', correct: 7 } }],
    }) as Record<string, unknown>;
    expect((result.final as Record<string, unknown>).correctChoiceIndex).toBe(-1);
    const step = (result.steps as Array<Record<string, unknown>>)[0]!;
    expect(step).not.toHaveProperty('explanation');
    expect((step.interaction as Record<string, unknown>).correct).toBeNull();
  });

  it('preserves the folder tree while sanitizing nested question files', () => {
    const spec = sanitizeBuilderSpec({
      version: '1.0', programTitle: 'Brevet',
      _adminWhiteboardData: { q1: { strokes: ['scratch'] } },
      root: {
        id: 'root', title: 'Brevet', questionTypes: [], children: [{
          id: 'chapters', title: 'Chapters', questionTypes: [], children: [{
            id: 'cat1', title: 'Factorisation', isCategory: true, children: [],
            questionTypes: [{ id: 'qt1', title: 'Sheet', jsonText: JSON.stringify([{ id: 'q1', question: 'Factor', modelAnswer: '(x+1)(x-1)' }]) }],
          }],
        }],
      },
    }) as any;

    expect(spec).not.toHaveProperty('_adminWhiteboardData');
    const category = spec.root.children[0].children[0];
    expect(category.title).toBe('Factorisation');
    expect(category.isCategory).toBe(true);
    const questions = JSON.parse(category.questionTypes[0].jsonText);
    expect(questions[0]).toEqual({ id: 'q1', question: 'Factor' });
  });

  it('empties unparseable question files instead of passing them through', () => {
    const spec = sanitizeBuilderSpec({
      root: { id: 'root', children: [], questionTypes: [{ id: 'qt', title: 't', jsonText: 'x=4 not json' }] },
    }) as any;
    expect(spec.root.questionTypes[0].jsonText).toBe('[]');
  });

  it('returns null for a program without a builder spec', () => {
    expect(sanitizeBuilderSpec(null)).toBeNull();
  });
});
