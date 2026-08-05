import { describe, expect, it } from 'vitest';
import { extractBuilderSpecAnswer } from './programAnswerReveal';

function questionType(id: string, questions: Array<Record<string, unknown>>) {
  return { id, title: `Sheet ${id}`, jsonText: JSON.stringify(questions) };
}

const builderSpec = {
  version: '1.0',
  programId: 'p1',
  root: {
    id: 'root',
    title: 'Root',
    children: [
      {
        id: 'folder1',
        title: 'Folder 1',
        children: [
          {
            id: 'sheetA',
            title: 'Sheet A',
            children: [],
            questionTypes: [questionType('qtA', [
              { id: 'q1', question: 'A one?', modelAnswer: 'answer-A', solution: 'because A', solutionPlan: 'plan A' },
            ])],
          },
        ],
        questionTypes: [],
      },
      {
        id: 'sheetB',
        title: 'Sheet B',
        children: [],
        questionTypes: [
          questionType('qtB', [{ id: 'q1', question: 'B one?', modelAnswer: 'answer-B' }]),
          questionType('qtC', [{ id: 'q1', question: 'C one?', modelAnswer: 'answer-C' }]),
        ],
      },
    ],
    questionTypes: [],
  },
};

describe('builder spec answer reveal', () => {
  it('finds a question inside a nested folder', () => {
    expect(extractBuilderSpecAnswer(builderSpec, {
      chapterId: 'sheetA', questionTypeId: 'qtA', questionId: 'q1',
    })).toMatchObject({ modelAnswer: 'answer-A', solution: 'because A', solutionPlan: 'plan A' });
  });

  it('disambiguates a repeated question id across question-type files', () => {
    expect(extractBuilderSpecAnswer(builderSpec, {
      chapterId: 'sheetB', questionTypeId: 'qtB', questionId: 'q1',
    }).modelAnswer).toBe('answer-B');
    expect(extractBuilderSpecAnswer(builderSpec, {
      chapterId: 'sheetB', questionTypeId: 'qtC', questionId: 'q1',
    }).modelAnswer).toBe('answer-C');
  });

  it('does not return a question from a different node', () => {
    expect(() => extractBuilderSpecAnswer(builderSpec, {
      chapterId: 'sheetA', questionTypeId: 'qtB', questionId: 'q1',
    })).toThrow(/sheet not found/i);
  });

  it('rejects unknown locators', () => {
    expect(() => extractBuilderSpecAnswer(builderSpec, {
      chapterId: 'nope', questionTypeId: 'qtA', questionId: 'q1',
    })).toThrow(/group not found/i);
    expect(() => extractBuilderSpecAnswer(builderSpec, {
      chapterId: 'sheetA', questionTypeId: 'qtA', questionId: 'q404',
    })).toThrow(/question not found/i);
  });

  it('normalizes missing and malformed answer metadata', () => {
    const spec = {
      root: {
        id: 'root',
        children: [],
        questionTypes: [questionType('qt1', [{ id: 'q1', question: 'No answer yet', answerProvenance: 'bogus' }])],
      },
    };
    expect(extractBuilderSpecAnswer(spec, { chapterId: 'root', questionTypeId: 'qt1', questionId: 'q1' })).toEqual({
      modelAnswer: null,
      solution: null,
      solutionPlan: null,
      gradingSchema: null,
      aiTutorNotes: null,
      answerProvenance: null,
      answerReviewStatus: null,
    });
  });

  it('refuses a program without builder-authored content', () => {
    expect(() => extractBuilderSpecAnswer(null, {
      chapterId: 'root', questionTypeId: 'qt1', questionId: 'q1',
    })).toThrow(/no builder-authored/i);
  });
});
