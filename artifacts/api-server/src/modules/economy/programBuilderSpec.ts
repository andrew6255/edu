import { fetchServiceRows } from '../../lib/supabaseServer';

/**
 * Fields that carry an answer, a worked solution, or authoring notes. They are
 * removed from every question before a builder spec is sent to a student.
 * Kept in sync with sanitize_program_builder_question in
 * program_builder_spec_confidentiality_migration.sql.
 */
const ANSWER_FIELDS = [
  'modelAnswer', 'rawAnswerText', 'answerFromPdf', 'solution', 'solutionPlan',
  'gradingSchema', 'explanationScenes', 'stepSolutions', 'answerProvenance',
  'answerReviewStatus', 'aiTutorNotes', 'correct_option_index',
] as const;

/** Answer-revealing keys inside an `interaction` object, by interaction type. */
const INTERACTION_ANSWER_FIELDS = [
  'solution', 'explanation', 'correctAnswer', 'modelAnswer', 'rawAnswerText',
] as const;

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}

export function sanitizeInteraction(value: unknown): unknown {
  const interaction = record(value);
  if (!interaction) return value;
  const result: Json = { ...interaction };
  for (const field of INTERACTION_ANSWER_FIELDS) delete result[field];

  switch (result.type) {
    case 'mcq':
      result.correctChoiceIndex = -1;
      break;
    case 'numeric':
      result.correct = null;
      break;
    case 'text':
      result.accepted = [];
      break;
    case 'line_equation':
      result.forms = [];
      break;
    case 'point_list': {
      const points = Array.isArray(result.points) ? result.points : [];
      if (result.minPoints === undefined) result.minPoints = points.length;
      if (result.maxPoints === undefined) result.maxPoints = result.minPoints;
      result.points = [];
      break;
    }
    case 'points_on_line':
      result.lineForms = [];
      result.disallowGivenPoints = [];
      break;
    case 'composite': {
      if (record(result.final)) result.final = sanitizeInteraction(result.final);
      if (Array.isArray(result.steps)) {
        result.steps = result.steps.map((step) => {
          const item = record(step);
          if (!item) return step;
          const { explanation: _explanation, ...rest } = item;
          if (record(rest.interaction)) rest.interaction = sanitizeInteraction(rest.interaction);
          return rest;
        });
      }
      break;
    }
  }
  return result;
}

export function sanitizeQuestion(value: unknown): unknown {
  const question = record(value);
  if (!question) return value;
  const result: Json = { ...question };
  for (const field of ANSWER_FIELDS) delete result[field];
  if (record(result.interaction)) result.interaction = sanitizeInteraction(result.interaction);
  return result;
}

/**
 * jsonText holds a JSON-encoded array of questions. Unparseable content is
 * emptied rather than passed through, so raw authoring text can never leak.
 */
function sanitizeQuestionTypeFile(value: unknown): unknown {
  const file = record(value);
  if (!file) return value;
  const jsonText = file.jsonText;
  if (typeof jsonText !== 'string' || !jsonText.trim()) return file;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ...file, jsonText: '[]' };
  }
  if (!Array.isArray(parsed)) return { ...file, jsonText: '[]' };
  return { ...file, jsonText: JSON.stringify(parsed.map(sanitizeQuestion)) };
}

function sanitizeNode(value: unknown): unknown {
  const node = record(value);
  if (!node) return value;
  const result: Json = { ...node };
  if (Array.isArray(result.questionTypes)) result.questionTypes = result.questionTypes.map(sanitizeQuestionTypeFile);
  if (Array.isArray(result.children)) result.children = result.children.map(sanitizeNode);
  return result;
}

export function sanitizeBuilderSpec(value: unknown): unknown {
  const spec = record(value);
  if (!spec) return null;
  const { _adminWhiteboardData: _dropped, ...rest } = spec;
  if (record(rest.root)) rest.root = sanitizeNode(rest.root);
  return rest;
}

export async function loadSanitizedBuilderSpec(programId: string): Promise<unknown> {
  const rows = await fetchServiceRows<{ builder_spec?: unknown }>('public_programs', {
    select: 'builder_spec', id: `eq.${programId}`, deleted_at: 'is.null', limit: '1',
  });
  const row = rows[0];
  if (!row) throw new Error('Published program not found');
  return sanitizeBuilderSpec(row.builder_spec);
}
