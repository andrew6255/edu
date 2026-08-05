import { fetchServiceRows } from '../../lib/supabaseServer';

export type BuilderAnswerPackage = {
  modelAnswer: string | null;
  solution: string | null;
  solutionPlan: string | null;
  gradingSchema: Array<{ criterion: string; points: number; deductionOnError?: string }> | null;
  aiTutorNotes: string | null;
  answerProvenance: 'source' | 'embedded_source' | 'ai_generated' | 'missing' | null;
  answerReviewStatus: 'approved' | 'pending_review' | null;
};

export type BuilderQuestionLocator = {
  chapterId: string;
  questionTypeId: string;
  questionId: string;
};

type BuilderRow = { builder_spec?: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function findNodeById(node: Record<string, unknown> | null, id: string): Record<string, unknown> | null {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findNodeById(record(child), id);
    if (found) return found;
  }
  return null;
}

/**
 * Question ids are only unique within a single questionTypes[] file, so the
 * locator is scoped by node and question-type before matching the question.
 * This mirrors how PersonalProgramView builds its question list client-side.
 */
export function extractBuilderSpecAnswer(builderSpec: unknown, locator: BuilderQuestionLocator): BuilderAnswerPackage {
  const spec = record(builderSpec);
  if (!spec) throw new Error('Published program has no builder-authored content');

  const node = findNodeById(record(spec.root), locator.chapterId);
  if (!node) throw new Error('Question group not found in this program');

  const questionTypes = Array.isArray(node.questionTypes) ? node.questionTypes : [];
  const questionTypeFile = questionTypes.map(record).find((file) => file?.id === locator.questionTypeId);
  if (!questionTypeFile) throw new Error('Question sheet not found in this program');

  let parsed: unknown[] = [];
  try {
    const raw = typeof questionTypeFile.jsonText === 'string' ? JSON.parse(questionTypeFile.jsonText) : [];
    if (Array.isArray(raw)) parsed = raw;
  } catch {
    throw new Error('Question sheet content could not be read');
  }

  const question = parsed.map(record).find((item) => item?.id === locator.questionId);
  if (!question) throw new Error('Question not found in this program');

  const provenance = question.answerProvenance;
  const reviewStatus = question.answerReviewStatus;

  return {
    modelAnswer: text(question.modelAnswer),
    solution: text(question.solution),
    solutionPlan: text(question.solutionPlan),
    gradingSchema: Array.isArray(question.gradingSchema)
      ? question.gradingSchema as BuilderAnswerPackage['gradingSchema']
      : null,
    aiTutorNotes: text(question.aiTutorNotes),
    answerProvenance: provenance === 'source' || provenance === 'embedded_source' || provenance === 'ai_generated' || provenance === 'missing'
      ? provenance
      : null,
    answerReviewStatus: reviewStatus === 'approved' || reviewStatus === 'pending_review' ? reviewStatus : null,
  };
}

export async function loadBuilderSpecAnswer(programId: string, locator: BuilderQuestionLocator): Promise<BuilderAnswerPackage> {
  const rows = await fetchServiceRows<BuilderRow>('public_programs', {
    select: 'builder_spec', id: `eq.${programId}`, deleted_at: 'is.null', limit: '1',
  });
  const row = rows[0];
  if (!row) throw new Error('Published program not found');
  return extractBuilderSpecAnswer(row.builder_spec, locator);
}
