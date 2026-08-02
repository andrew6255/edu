import { describe, expect, it } from 'vitest';
import { buildPaperQuestionShape } from './paperQuestionParts';

describe('buildPaperQuestionShape', () => {
  it('separates a shared heading from numbered paper regions', () => {
    const shape = buildPaperQuestionShape({
      id: 'algebra-1',
      rawText: 'We have A = 2x + 3 and B = 5x - 4\n1) Calculate A and B when x = 3\n2) Calculate A and B when x = 5',
    });

    expect(shape.context).toBe('We have A = 2x + 3 and B = 5x - 4');
    expect(shape.parts).toEqual([
      { id: 'algebra-1:parsed:0', label: '1)', prompt: 'Calculate A and B when x = 3' },
      { id: 'algebra-1:parsed:1', label: '2)', prompt: 'Calculate A and B when x = 5' },
    ]);
  });

  it('keeps a single prompt in one answer region', () => {
    const shape = buildPaperQuestionShape({ id: 'single', rawText: 'Factorise x² - 9.' });

    expect(shape.context).toBe('');
    expect(shape.parts).toEqual([{ id: 'single:main', label: '', prompt: 'Factorise x² - 9.' }]);
  });

  it('prefers explicit subquestions when extraction supplied them', () => {
    const shape = buildPaperQuestionShape({
      id: 'explicit',
      rawText: 'Use the definitions below.',
      context: 'Use the definitions below.',
      subQuestions: [
        { id: 'a', label: 'A)', rawText: 'Find the first value.' },
        { id: 'b', label: 'B)', rawText: 'Justify the result.' },
      ],
    });

    expect(shape.context).toBe('Use the definitions below.');
    expect(shape.parts.map(part => [part.label, part.prompt])).toEqual([
      ['A)', 'Find the first value.'],
      ['B)', 'Justify the result.'],
    ]);
  });
});
