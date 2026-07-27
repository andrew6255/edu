import { describe, it, expect } from 'vitest';
import { normalizeQuestionBlock } from './normalization';
import type { ExtractedQuestionBlock } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBlock(rawText: string, overrides: Partial<ExtractedQuestionBlock> = {}): ExtractedQuestionBlock {
  return {
    id: 'test-block-1',
    rawText,
    page: 1,
    questionLabel: 'Q1',
    regionIds: [],
    notes: [],
    ...overrides,
  };
}

// ─── MCQ Detection ────────────────────────────────────────────────────────────

describe('normalizeQuestionBlock — MCQ detection', () => {
  it('detects a single-choice MCQ when options A) B) C) D) are present', () => {
    const raw = `Which of the following is a prime number?
A) 9
B) 15
C) 17
D) 21`;
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('mcq_single');
    expect(result.recommendedGradingMode).toBe('deterministic');
    expect(result.normalizedQuestion!.grading.answerFormat).toBe('choice');
  });

  it('detects MCQ with dot-separated options like A. B. C. D.', () => {
    const raw = `What is 2 + 2?
A. 3
B. 4
C. 5
D. 6`;
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('mcq_single');
  });

  it('does not misclassify a plain text question without options as MCQ', () => {
    const raw = 'Explain the concept of photosynthesis in your own words.';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('open_response_ai');
  });
});

// ─── True/False Detection ──────────────────────────────────────────────────────

describe('normalizeQuestionBlock — True/False detection', () => {
  it('detects a True/False question', () => {
    const raw = 'The Earth is flat. True or False?';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('true_false');
    expect(result.recommendedGradingMode).toBe('deterministic');
  });

  it('detects True/False regardless of casing', () => {
    const raw = 'Water boils at 100°C at sea level. TRUE or FALSE.';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('true_false');
  });
});

// ─── Line Equation Detection ───────────────────────────────────────────────────

describe('normalizeQuestionBlock — Line equation detection', () => {
  it('detects "find the equation of the line" with two coordinate pairs', () => {
    const raw = 'Find the equation of the line passing through (1, 2) and (3, 6).';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('equation_input');
    expect(result.recommendedGradingMode).toBe('deterministic');
    expect(result.normalizedQuestion!.grading.answerFormat).toBe('equation');
  });

  it('computes the correct slope-intercept form y=2x for (0,0) and (1,2)', () => {
    const raw = 'Find the equation of the line passing through (0, 0) and (1, 2).';
    const result = normalizeQuestionBlock(makeBlock(raw));
    const structured = result.normalizedQuestion!.answerData.final;
    expect(structured?.type).toBe('line_equation');
    if (structured?.type === 'line_equation') {
      expect(structured.forms).toContain('y=2x');
    }
  });

  it('falls back to open_response_ai if line is requested but fewer than 2 points given', () => {
    const raw = 'Find the equation of the line that goes through (2, 4).';
    const result = normalizeQuestionBlock(makeBlock(raw));
    // Only one point — cannot determine unique line equation deterministically
    expect(result.recommendedGradingMode).not.toBe('deterministic');
  });
});

// ─── Point List Generation ─────────────────────────────────────────────────────

describe('normalizeQuestionBlock — Point list generation', () => {
  it('generates 10 coordinate pairs for "list 10 points on y=3x+1"', () => {
    const raw = 'List 10 points on the line y=3x+1.';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('ordered_steps');
    const structured = result.normalizedQuestion!.answerData.final;
    expect(structured?.type).toBe('point_list');
    if (structured?.type === 'point_list') {
      expect(structured.points).toHaveLength(10);
      // Verify first point matches y=3(0)+1=1
      expect(structured.points[0]).toEqual({ x: 0, y: 1 });
      // Verify fourth point: y=3(3)+1=10
      expect(structured.points[3]).toEqual({ x: 3, y: 10 });
    }
  });

  it('generates points for "generate 10 points on y=x"', () => {
    const raw = 'Generate 10 points on y=x.';
    const result = normalizeQuestionBlock(makeBlock(raw));
    const structured = result.normalizedQuestion!.answerData.final;
    expect(structured?.type).toBe('point_list');
    if (structured?.type === 'point_list') {
      // For y=x, point at index 5 should be (5, 5)
      expect(structured.points[5]).toEqual({ x: 5, y: 5 });
    }
  });
});

// ─── Open Response Fallback ────────────────────────────────────────────────────

describe('normalizeQuestionBlock — Open response fallback', () => {
  it('defaults to open_response_ai for unrecognised question types', () => {
    const raw = 'Describe the water cycle in detail.';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.detectedKind).toBe('open_response_ai');
    expect(result.recommendedGradingMode).toBe('ai_rubric');
    expect(result.normalizedQuestion!.grading.mode).toBe('ai_rubric');
  });

  it('includes a valid question id from the block id', () => {
    const block = makeBlock('What is gravity?', { id: 'block-xyz-99' });
    const result = normalizeQuestionBlock(block);
    expect(result.normalizedQuestion!.id).toBe('block-xyz-99');
  });

  it('sets the prompt text to the trimmed raw text', () => {
    const raw = '   What is the speed of light?   ';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.normalizedQuestion!.prompt[0]).toEqual({
      type: 'text',
      text: 'What is the speed of light?',
    });
  });
});

// ─── Multi-part Detection ──────────────────────────────────────────────────────

describe('normalizeQuestionBlock — isMultiPart detection', () => {
  it('marks a question with (a) (b) sub-parts as multi-part', () => {
    const raw = 'Solve the following:\n(a) What is 2+2?\n(b) What is 3+3?';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.isMultiPart).toBe(true);
  });

  it('does not mark a single-question block as multi-part', () => {
    const raw = 'What is the square root of 144?';
    const result = normalizeQuestionBlock(makeBlock(raw));
    expect(result.isMultiPart).toBe(false);
  });
});

// ─── Source metadata ───────────────────────────────────────────────────────────

describe('normalizeQuestionBlock — Source metadata', () => {
  it('marks question as extracted from scan when scanConfidence < 0.7', () => {
    const block = makeBlock('A scanned question text.', { scanConfidence: 0.5 });
    const result = normalizeQuestionBlock(block);
    expect(result.normalizedQuestion!.source.extractedFromScan).toBe(true);
  });

  it('does not mark question as from scan when scanConfidence >= 0.7', () => {
    const block = makeBlock('A digital-quality question.', { scanConfidence: 0.85 });
    const result = normalizeQuestionBlock(block);
    expect(result.normalizedQuestion!.source.extractedFromScan).toBe(false);
  });
});
