import {
  type BuilderQuestion,
  type BuilderQuestionTypeFile,
  type BuilderSpec,
  FIXED_FIRST_DIVISION_NODE_ID,
  ensureFixedFirstDivisionContainer,
  makeIdFromTitle,
  makeStableId,
  newBuilderSpec,
} from '@/lib/programBuilder';
import type {
  ProgramAtomicInteractionSpec,
  ProgramExplanationScene,
  ProgramPromptBlock,
  ProgramStepSpec,
} from '@/lib/programQuestionBank';

export type AIProgramImport = {
  version: 'ai_program_import_v1';
  program: {
    title: string;
    subject?: string;
    gradeBand?: string;
    coverEmoji?: string;
    sourceType?: string;
    sourceLabel?: string;
    notes?: string;
  };
  organization: {
    chapters: AIImportChapter[];
  };
};

export type AIImportChapter = {
  title: string;
  questionTypes: AIImportQuestionType[];
};

export type AIImportQuestionType = {
  title: string;
  questions: AIImportQuestion[];
};

export type AIImportQuestion = {
  id: string;
  question?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  points?: number;
  time_required_seconds?: number;
  tags?: string[];
  promptBlocks?: ProgramPromptBlock[];
  interaction: {
    type: string;
    [key: string]: unknown;
  };
  hint?: string | string[] | null;
  solution?: string | null;
  stepSolutions?: Array<{
    id?: string;
    title?: string;
    prompt?: ProgramPromptBlock[];
    interaction?: {
      type: string;
      [key: string]: unknown;
    };
    explanation?: string | null;
  }>;
  explanationScenes?: Array<{
    id?: string;
    title?: string;
    narration?: string | null;
    beforeText?: string | null;
    afterText?: string | null;
    emphasis?: string[];
    action?: 'highlight' | 'transform' | 'note' | 'reveal';
  }>;
  aiMeta?: {
    confidence?: number;
    sourceQuestionLabel?: string;
    needsReview?: boolean;
    mode?: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
}

function coercePoint(value: unknown): { x: number; y: number } | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const x = Number(record.x);
  const y = Number(record.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function coercePointArray(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => coercePoint(entry))
    .filter((entry): entry is { x: number; y: number } => entry !== null);
}

function toPromptBlocks(value: unknown, fallbackText: string): ProgramPromptBlock[] {
  if (Array.isArray(value) && value.length > 0) {
    const blocks = value
      .map((block) => {
        const item = asRecord(block);
        if (!item || typeof item.type !== 'string') return null;
        if (item.type === 'text') {
          return typeof item.text === 'string' && item.text.trim()
            ? ({ type: 'text', text: item.text } satisfies ProgramPromptBlock)
            : null;
        }
        if (item.type === 'math') {
          return typeof item.latex === 'string' && item.latex.trim()
            ? ({ type: 'math', latex: item.latex } satisfies ProgramPromptBlock)
            : null;
        }
        if (item.type === 'image' && typeof item.url === 'string' && item.url.trim()) {
          return {
            type: 'image',
            url: item.url,
            alt: typeof item.alt === 'string' ? item.alt : undefined,
            caption: typeof item.caption === 'string' ? item.caption : undefined,
          } satisfies ProgramPromptBlock;
        }
        if (item.type === 'table' && Array.isArray(item.rows)) {
          return {
            type: 'table',
            rows: item.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : [])),
            headerRows: typeof item.headerRows === 'number' ? item.headerRows : undefined,
          } satisfies ProgramPromptBlock;
        }
        return null;
      })
      .filter(Boolean) as ProgramPromptBlock[];
    if (blocks.length > 0) return blocks;
  }
  return fallbackText.trim() ? [{ type: 'text', text: fallbackText }] : [];
}

function parseAtomicInteraction(value: unknown): ProgramAtomicInteractionSpec | null {
  const item = asRecord(value);
  if (!item || typeof item.type !== 'string') return null;

  if (item.type === 'mcq') {
    const choices = getStringArray(item.choices);
    const correctChoiceIndex = Number(item.correctChoiceIndex);
    if (choices.length < 2 || !Number.isInteger(correctChoiceIndex) || correctChoiceIndex < 0 || correctChoiceIndex >= choices.length) return null;
    return { type: 'mcq', choices, correctChoiceIndex };
  }

  if (item.type === 'numeric') {
    const raw = Array.isArray(item.correct) ? item.correct : [item.correct];
    const correct = raw.map((entry) => (typeof entry === 'number' ? entry : Number(entry))).filter((entry) => Number.isFinite(entry));
    if (correct.length === 0) return null;
    return {
      type: 'numeric',
      correct: correct.length === 1 ? correct[0]! : correct,
      tolerance: typeof item.tolerance === 'number' ? item.tolerance : undefined,
      format: item.format === 'integer' || item.format === 'decimal' || item.format === 'fraction' ? item.format : undefined,
      keypad: item.keypad === 'basic' || item.keypad === 'scientific' ? item.keypad : undefined,
    };
  }

  if (item.type === 'text') {
    const accepted = getStringArray(item.accepted);
    if (accepted.length === 0) return null;
    return {
      type: 'text',
      accepted,
      caseSensitive: item.caseSensitive === true,
      trim: item.trim !== false,
    };
  }

  if (item.type === 'line_equation') {
    const forms = getStringArray(item.forms);
    if (forms.length === 0) return null;
    return {
      type: 'line_equation',
      forms,
      variable: typeof item.variable === 'string' && item.variable.trim() ? item.variable : undefined,
      caseSensitive: item.caseSensitive === true,
      trim: item.trim !== false,
    };
  }

  if (item.type === 'point_list') {
    const points = coercePointArray(item.points);
    if (points.length === 0) return null;
    return {
      type: 'point_list',
      points,
      minPoints: typeof item.minPoints === 'number' ? item.minPoints : undefined,
      maxPoints: typeof item.maxPoints === 'number' ? item.maxPoints : undefined,
      ordered: item.ordered === true,
      allowEquivalentOrder: item.allowEquivalentOrder !== false,
    };
  }

  if (item.type === 'points_on_line') {
    const lineForms = getStringArray(item.lineForms);
    if (lineForms.length === 0) return null;
    const disallowGivenPoints = Array.isArray(item.disallowGivenPoints)
      ? coercePointArray(item.disallowGivenPoints)
      : undefined;
    return {
      type: 'points_on_line',
      lineForms,
      minPoints: typeof item.minPoints === 'number' ? item.minPoints : 1,
      maxPoints: typeof item.maxPoints === 'number' ? item.maxPoints : undefined,
      disallowGivenPoints,
      requireDistinct: item.requireDistinct !== false,
    };
  }

  if (item.type === 'freeform') {
    return {
      type: 'freeform',
      grading: item.grading === 'ai' ? 'ai' : 'manual',
      placeholder: typeof item.placeholder === 'string' ? item.placeholder : undefined,
      rubricSummary: typeof item.rubricSummary === 'string' ? item.rubricSummary : null,
      acceptSteps: item.acceptSteps === true,
    };
  }

  return null;
}

function parseExplanationScenes(value: unknown): ProgramExplanationScene[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((scene, idx) => {
      const item = asRecord(scene);
      if (!item) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `scene_${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Scene ${idx + 1}`,
        narration: typeof item.narration === 'string' ? item.narration : null,
        beforeText: typeof item.beforeText === 'string' ? item.beforeText : null,
        afterText: typeof item.afterText === 'string' ? item.afterText : null,
        emphasis: Array.isArray(item.emphasis) ? item.emphasis.map((entry) => String(entry)).filter(Boolean) : undefined,
        action: item.action === 'highlight' || item.action === 'transform' || item.action === 'note' || item.action === 'reveal' ? item.action : undefined,
      } satisfies ProgramExplanationScene;
    })
    .filter(Boolean) as ProgramExplanationScene[];
}

function parseStepSolutions(value: unknown): ProgramStepSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((step, idx) => {
      const item = asRecord(step);
      if (!item) return null;
      const interaction = parseAtomicInteraction(item.interaction);
      if (!interaction) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `step_${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Step ${idx + 1}`,
        prompt: toPromptBlocks(item.prompt, typeof item.title === 'string' ? item.title : `Step ${idx + 1}`),
        interaction,
        explanation: typeof item.explanation === 'string' ? item.explanation : null,
      } satisfies ProgramStepSpec;
    })
    .filter(Boolean) as ProgramStepSpec[];
}

function parseQuestion(value: unknown, chapterTitle: string, questionTypeTitle: string, questionIndex: number): BuilderQuestion {
  const item = asRecord(value);
  if (!item) throw new Error(`Question ${questionIndex + 1} in ${chapterTitle} / ${questionTypeTitle} is not an object.`);

  const fallbackQuestion = typeof item.question === 'string' ? item.question : '';
  const promptBlocks = toPromptBlocks(item.promptBlocks, fallbackQuestion);
  const promptText = fallbackQuestion.trim() || promptBlocks.map((block) => ('text' in block ? block.text : 'latex' in block ? block.latex : '')).join('\n').trim();
  if (!promptText && promptBlocks.length === 0) {
    throw new Error(`Question ${questionIndex + 1} in ${chapterTitle} / ${questionTypeTitle} is missing prompt text.`);
  }

  const interactionRecord = asRecord(item.interaction);
  if (!interactionRecord || typeof interactionRecord.type !== 'string') {
    throw new Error(`Question ${item.id ?? questionIndex + 1} in ${chapterTitle} / ${questionTypeTitle} is missing a valid interaction.`);
  }

  let interaction: BuilderQuestion['interaction'];
  if (interactionRecord.type === 'composite') {
    const finalInteraction = parseAtomicInteraction(interactionRecord.final);
    if (!finalInteraction) {
      throw new Error(`Composite question ${item.id ?? questionIndex + 1} in ${chapterTitle} / ${questionTypeTitle} is missing a valid final interaction.`);
    }
    const steps = parseStepSolutions(interactionRecord.steps);
    interaction = {
      type: 'composite',
      final: finalInteraction,
      steps,
      allowDirectFinalAnswer: interactionRecord.allowDirectFinalAnswer !== false,
      scoreStrategy: interactionRecord.scoreStrategy === 'final_plus_steps' ? 'final_plus_steps' : 'final_only',
    };
  } else {
    const atomic = parseAtomicInteraction(interactionRecord);
    if (!atomic) {
      throw new Error(`Question ${item.id ?? questionIndex + 1} in ${chapterTitle} / ${questionTypeTitle} has an unsupported interaction.`);
    }
    interaction = atomic;
  }

  const difficulty = item.difficulty;
  if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') {
    throw new Error(`Question ${item.id ?? questionIndex + 1} in ${chapterTitle} / ${questionTypeTitle} has invalid difficulty.`);
  }

  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : `q_${questionIndex + 1}`,
    question: promptText || `Question ${questionIndex + 1}`,
    options: [],
    correct_option_index: 0,
    difficulty,
    time_required_seconds: typeof item.time_required_seconds === 'number' ? item.time_required_seconds : undefined,
    hint: Array.isArray(item.hint) ? getStringArray(item.hint) : (typeof item.hint === 'string' ? item.hint : null),
    solution: typeof item.solution === 'string' ? item.solution : null,
    explanationScenes: parseExplanationScenes(item.explanationScenes),
    stepSolutions: parseStepSolutions(item.stepSolutions),
    points: typeof item.points === 'number' ? item.points : undefined,
    promptBlocks,
    interaction,
  } satisfies BuilderQuestion;
}

export function parseAIProgramImport(jsonText: string): BuilderSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid AI import JSON: ${msg}`);
  }

  const root = asRecord(raw);
  if (!root) throw new Error('AI import payload must be a JSON object.');
  if (root.version !== 'ai_program_import_v1') throw new Error('Unsupported AI import version. Expected ai_program_import_v1.');

  const program = asRecord(root.program);
  if (!program || typeof program.title !== 'string' || !program.title.trim()) {
    throw new Error('AI import payload is missing program.title.');
  }
  const organization = asRecord(root.organization);
  const chapters = Array.isArray(organization?.chapters) ? organization!.chapters : null;
  if (!chapters || chapters.length === 0) {
    throw new Error('AI import payload must include organization.chapters with at least one chapter.');
  }

  const builder = newBuilderSpec();
  builder.programTitle = program.title.trim();
  builder.programId = makeIdFromTitle(program.title.trim()) || makeStableId('program');
  builder.subject = typeof program.subject === 'string' && program.subject.trim() ? program.subject : 'mathematics';
  builder.gradeBand = typeof program.gradeBand === 'string' ? program.gradeBand : '';
  builder.coverEmoji = typeof program.coverEmoji === 'string' && program.coverEmoji.trim() ? program.coverEmoji : '📘';
  builder.root.title = builder.programTitle;
  builder.divisions = ['Chapters'];

  const chapterNodes = chapters.map((chapterValue, chapterIndex) => {
    const chapter = asRecord(chapterValue);
    if (!chapter || typeof chapter.title !== 'string' || !chapter.title.trim()) {
      throw new Error(`Chapter ${chapterIndex + 1} is missing title.`);
    }
    const chapterTitle = chapter.title;
    const questionTypes = Array.isArray(chapter.questionTypes) ? chapter.questionTypes : [];
    if (questionTypes.length === 0) {
      throw new Error(`Chapter ${chapterTitle} must include at least one question type.`);
    }

    const qtFiles: BuilderQuestionTypeFile[] = questionTypes.map((questionTypeValue, qtIndex) => {
      const questionType = asRecord(questionTypeValue);
      if (!questionType || typeof questionType.title !== 'string' || !questionType.title.trim()) {
        throw new Error(`Question type ${qtIndex + 1} in chapter ${chapterTitle} is missing title.`);
      }
      const questionTypeTitle = questionType.title;
      const questions = Array.isArray(questionType.questions) ? questionType.questions : [];
      if (questions.length === 0) {
        throw new Error(`Question type ${questionTypeTitle} in chapter ${chapterTitle} must include at least one question.`);
      }
      const parsedQuestions = questions.map((question, qIndex) => parseQuestion(question, chapterTitle, questionTypeTitle, qIndex));
      return {
        id: makeStableId('qt'),
        title: questionTypeTitle,
        jsonText: JSON.stringify(parsedQuestions, null, 2),
      } satisfies BuilderQuestionTypeFile;
    });

    return {
      id: makeStableId('node'),
      title: chapterTitle,
      children: [],
      questionTypes: qtFiles,
    };
  });

  const normalized = ensureFixedFirstDivisionContainer(builder);
  const fixed = normalized.root.children.find((child) => child.id === FIXED_FIRST_DIVISION_NODE_ID);
  if (fixed) {
    fixed.children = chapterNodes;
  }
  return ensureFixedFirstDivisionContainer(normalized);
}
