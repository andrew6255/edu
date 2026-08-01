import { describe, expect, it } from 'vitest';
import { normalizeImportedQuestions } from './QuestionImportStudio';

describe('Question Import Studio normalization', () => {
  it('normalizes audited extractor output and retains source metadata', () => {
    const questions = normalizeImportedQuestions({
      questions: [{
        promptRawText: 'Find the equation of the line.',
        promptBlocks: [{ type: 'text', text: 'Find the equation of the line.' }],
        interaction: { type: 'mcq', choices: ['y=x', 'y=2x'], correctChoiceIndex: 1 },
        pageNumber: 4,
        questionNumber: 12,
        reviewStatus: 'FLAGGED_FOR_REVIEW',
        flags: ['AMBIGUOUS_ANSWER'],
      }],
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      promptRawText: 'Find the equation of the line.',
      pageNumber: 4,
      questionNumber: 12,
      reviewStatus: 'FLAGGED_FOR_REVIEW',
      flags: ['AMBIGUOUS_ANSWER'],
    });
  });

  it('returns an empty list for malformed results', () => {
    expect(normalizeImportedQuestions({ questions: null })).toEqual([]);
  });

  it('uses extractor raw text when promptRawText is absent', () => {
    const questions = normalizeImportedQuestions({ questions: [{ rawText: 'Expand and factorize x² - 9.', promptBlocks: [], interaction: { type: 'free_response' } }] });
    expect(questions[0]?.promptRawText).toBe('Expand and factorize x² - 9.');
  });

  it('keeps missing answers empty and maps only explicit source answers', () => {
    const questions = normalizeImportedQuestions({ questions: [
      { promptRawText: 'Answered', interaction: { type: 'mcq', choices: ['A', 'B'], correctChoiceIndex: 1 } },
      { promptRawText: 'Unanswered', interaction: { type: 'mcq', choices: ['A', 'B'], correctChoiceIndex: -1 } },
    ] });
    expect(questions[0]?.modelAnswer).toBe('B');
    expect(questions[1]?.modelAnswer).toBe('');
  });
});
