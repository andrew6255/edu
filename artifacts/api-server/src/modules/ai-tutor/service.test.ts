import { describe, expect, it } from 'vitest';
import { aiTutorService } from './service';

describe('AiTutorService paper help', () => {
  it('uses the canonical full solution directly for solve mode', async () => {
    const result = await aiTutorService.getPaperHelp({
      mode: 'solve',
      questionId: 'question-1',
      questionPrompt: 'Calculate $2 \\times 3$.',
      answerPackage: {
        modelAnswer: '$6$',
        highLevelSteps: ['Multiply'],
        fullSolution: [{ title: 'Calculate', body: '$2 \\times 3 = 6$' }],
        gradingRubric: [{ criterion: 'Correct answer', points: 100 }],
        provenance: 'ai_generated',
        reviewStatus: 'pending_review',
      },
    });

    expect(result.mode).toBe('solve');
    expect(result.steps).toEqual([{ title: 'Calculate', body: '$2 \\times 3 = 6$' }]);
  });
});
