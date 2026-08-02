import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleTutorProvider, parseProviderAnswerPackage } from './providers';

describe('parseProviderAnswerPackage', () => {
  it('accepts the canonical answer-package shape', () => {
    const result = parseProviderAnswerPackage({
      modelAnswer: 'x = 4',
      highLevelSteps: ['Isolate x'],
      fullSolution: [{ title: 'Solve', body: '2x = 8, so x = 4.' }],
      gradingRubric: [{ criterion: 'Correct result', points: 100 }],
    });

    expect(result?.modelAnswer).toBe('x = 4');
    expect(result?.fullSolution).toHaveLength(1);
    expect(result?.gradingRubric).toEqual([{ criterion: 'Correct result', points: 100 }]);
  });

  it('normalizes common model field variations instead of rejecting the response', () => {
    const result = parseProviderAnswerPackage({
      final_answer: 'x = 4',
      stepsPlan: 'Subtract 3\nDivide by 2',
      solutionSteps: ['2x + 3 = 11', '2x = 8', 'x = 4'],
      rubric: [{ description: 'Correct method and result', score: '100' }],
    });

    expect(result?.modelAnswer).toBe('x = 4');
    expect(result?.highLevelSteps).toEqual(['Subtract 3', 'Divide by 2']);
    expect(result?.fullSolution).toHaveLength(3);
    expect(result?.gradingRubric).toEqual([{ criterion: 'Correct method and result', points: 100 }]);
  });

  it('keeps plans concise and removes raw multiplication asterisks from displayed math', () => {
    const result = parseProviderAnswerPackage({
      modelAnswer: '$A = 2 * 3$',
      highLevelSteps: ['one', 'two', 'three', 'four', 'five', 'six'],
      fullSolution: [{ title: 'Evaluate $A$', body: '$A = 2 * 3 = 6$' }],
      gradingRubric: [{ criterion: 'Correct result', points: 100 }],
    });

    expect(result?.highLevelSteps).toHaveLength(5);
    expect(result?.modelAnswer).toBe('$A = 2 \\times 3$');
    expect(result?.fullSolution[0].body).toBe('$A = 2 \\times 3 = 6$');
  });

  it('falls back to the configured answer model when the primary model is rate limited', async () => {
    const previousGroqKey = process.env['GROQ_API_KEY'];
    const previousModel = process.env['AI_TUTOR_MODEL'];
    const previousFallback = process.env['AI_TUTOR_ANSWER_FALLBACK_MODEL'];
    process.env['GROQ_API_KEY'] = 'test-key';
    process.env['AI_TUTOR_MODEL'] = 'primary-model';
    process.env['AI_TUTOR_ANSWER_FALLBACK_MODEL'] = 'fallback-model';
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":{"message":"rate limited"}}', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        modelAnswer: '$x=4$',
        highLevelSteps: ['Solve'],
        fullSolution: [{ title: 'Solve', body: '$x=4$' }],
        gradingRubric: [{ criterion: 'Correct answer', points: 100 }],
      }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    try {
      const answer = await new OpenAiCompatibleTutorProvider().generateAnswer('Solve $x=4$.');
      expect(answer?.model).toBe('fallback-model');
      const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      expect(secondRequest.model).toBe('fallback-model');
    } finally {
      fetchMock.mockRestore();
      if (previousGroqKey === undefined) delete process.env['GROQ_API_KEY']; else process.env['GROQ_API_KEY'] = previousGroqKey;
      if (previousModel === undefined) delete process.env['AI_TUTOR_MODEL']; else process.env['AI_TUTOR_MODEL'] = previousModel;
      if (previousFallback === undefined) delete process.env['AI_TUTOR_ANSWER_FALLBACK_MODEL']; else process.env['AI_TUTOR_ANSWER_FALLBACK_MODEL'] = previousFallback;
    }
  });
});
