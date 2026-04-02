import type { TocData, TocItem } from '@/lib/programMaps';
import {
  type ProgramAnnotationsFile,
  type ProgramChapter,
  type ProgramDifficulty,
  type ProgramInteractionSpec,
  type ProgramPromptBlock,
  type ProgramMetaFile,
  parseJsonText,
} from '@/lib/programQuestionBank';

export const BUILDER_DIVISION_LABELS = [
  'Chapters',
  'Topics',
  'Themes',
  'Subsection',
  'Section',
  'Subtopics',
  'Ideas',
  'Units',
  'Modules',
  'Lessons',
  'Key Concepts',
  'Learning Objectives',
] as const;

export type BuilderDivisionLabel = (typeof BUILDER_DIVISION_LABELS)[number];

export type BuilderQuestion = {
  id: string;
  question: string;
  options: string[];
  correct_option_index: number;
  difficulty: ProgramDifficulty;
  time_required_seconds?: number;
  hint?: string | string[] | null;
  solution?: string | null;
  points?: number;

  // New schema (Phase 1): rich prompt blocks + interaction spec.
  // Still allow legacy fields above to keep older JSON working.
  promptBlocks?: ProgramPromptBlock[];
  interaction?: ProgramInteractionSpec;
};

export type BuilderQuestionTypeFile = {
  id: string;
  title: string;
  jsonText: string;
};

export type BuilderNode = {
  id: string;
  title: string;
  children: BuilderNode[];
  questionTypes: BuilderQuestionTypeFile[];
};

export type BuilderSpec = {
  version: '1.0';
  programId: string;
  programTitle: string;
  subject?: string;
  gradeBand?: string;
  coverEmoji?: string;
  divisions: BuilderDivisionLabel[]; // does NOT include final "Question Types"
  root: BuilderNode;
};

export const FIXED_FIRST_DIVISION_NODE_ID = 'fixed_first_division';

export function makeIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function makeStableId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function ensureFixedFirstDivisionContainer(spec: BuilderSpec): BuilderSpec {
  const firstLabel = spec.divisions[0] ?? 'Topics';
  const children = Array.isArray(spec.root.children) ? spec.root.children : [];
  const fixed = children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
  const nextFixed: BuilderNode = fixed
    ? { ...fixed, title: firstLabel }
    : { id: FIXED_FIRST_DIVISION_NODE_ID, title: firstLabel, children: [], questionTypes: [] };

  const nextChildren: BuilderNode[] = fixed
    ? children.map((c) => (c.id === FIXED_FIRST_DIVISION_NODE_ID ? nextFixed : c))
    : [nextFixed, ...children];

  return {
    ...spec,
    divisions: spec.divisions.length > 0 ? spec.divisions : ['Topics'],
    root: {
      ...spec.root,
      children: nextChildren,
    },
  };
}

export function newBuilderSpec(): BuilderSpec {
  const root: BuilderNode = {
    id: 'root',
    title: 'Enter program title',
    children: [],
    questionTypes: [],
  };
  return ensureFixedFirstDivisionContainer({
    version: '1.0',
    programId: '',
    programTitle: '',
    subject: 'mathematics',
    gradeBand: '',
    coverEmoji: '📘',
    divisions: ['Topics'],
    root,
  });
}

export function parseQuestionTypeJson(text: string): BuilderQuestion[] {
  const raw = parseJsonText<unknown>(text, 'question type');
  if (!Array.isArray(raw)) throw new Error('Question type file must be a JSON array of questions');

  return raw.map((q: any, idx: number) => {
    const id = typeof q?.id === 'string' ? q.id : String(q?.id ?? `q_${idx + 1}`);
    const question = typeof q?.question === 'string' ? q.question : '';

    const promptBlocksRaw = q?.promptBlocks;
    const promptBlocks: ProgramPromptBlock[] | undefined = Array.isArray(promptBlocksRaw)
      ? (promptBlocksRaw as unknown[]).filter(Boolean).map((b) => b as ProgramPromptBlock)
      : undefined;

    const interaction: ProgramInteractionSpec | undefined = q?.interaction && typeof q.interaction === 'object'
      ? (q.interaction as ProgramInteractionSpec)
      : undefined;

    // Legacy MCQ fields (required unless interaction supplies it)
    const options = Array.isArray(q?.options) ? q.options.map((x: any) => String(x)) : [];
    const correct_option_index = Number(q?.correct_option_index);

    const hasLegacyMcq = options.length >= 2 && Number.isFinite(correct_option_index) && correct_option_index >= 0 && correct_option_index < options.length;
    const hasInteraction = !!interaction && typeof (interaction as any).type === 'string';

    // Require some form of prompt text (legacy `question` or promptBlocks)
    const hasPrompt = (typeof question === 'string' && question.trim().length > 0) || (Array.isArray(promptBlocks) && promptBlocks.length > 0);
    if (!hasPrompt) throw new Error(`Question ${id} missing prompt (question or promptBlocks)`);

    // Require a gradable interaction. For now we allow either:
    // - interaction spec
    // - legacy mcq fields
    if (!hasInteraction && !hasLegacyMcq) {
      throw new Error(`Question ${id} missing interaction (provide interaction or legacy options/correct_option_index)`);
    }

    if (hasLegacyMcq) {
      if (!Number.isFinite(correct_option_index) || correct_option_index < 0 || correct_option_index >= options.length) {
        throw new Error(`Question ${id} has invalid correct_option_index`);
      }
      if (options.length < 2) throw new Error(`Question ${id} must have at least 2 options`);
    }

    const difficulty = q?.difficulty as ProgramDifficulty;
    if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') {
      throw new Error(`Question ${id} has invalid difficulty`);
    }

    return {
      id,
      question,
      options,
      correct_option_index,
      difficulty,
      time_required_seconds: q?.time_required_seconds != null ? Number(q.time_required_seconds) : undefined,
      hint: q?.hint ?? null,
      solution: q?.solution ?? null,
      points: q?.points != null ? Number(q.points) : undefined,
      promptBlocks,
      interaction,
    } satisfies BuilderQuestion;
  });
}

function walk(
  node: BuilderNode,
  fn: (node: BuilderNode, path: BuilderNode[]) => void,
  path: BuilderNode[] = []
) {
  const nextPath = [...path, node];
  fn(node, nextPath);
  for (const c of node.children) walk(c, fn, nextPath);
}

function tocItemFromNode(node: BuilderNode, level: number): TocItem {
  return {
    id: node.id,
    title: node.title,
    level,
    children: node.children.map((c) => tocItemFromNode(c, level + 1)),
  };
}

export function convertBuilderToInternal(spec: BuilderSpec): {
  toc: TocData;
  questionBanksByChapter: Record<string, ProgramChapter>;
  annotations: ProgramAnnotationsFile;
  programMeta: ProgramMetaFile;
  rankedTotalQuestionCount: number;
} {
  const normalized = ensureFixedFirstDivisionContainer(spec);
  const fixedContainer = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
  const topFolders = fixedContainer ? fixedContainer.children : normalized.root.children;

  const toc: TocData = {
    program_id: normalized.programId,
    program_title: normalized.programTitle,
    toc_tree: topFolders.map((c) => tocItemFromNode(c, 1)),
    toc_notes: [],
  };

  const programMeta: ProgramMetaFile = {
    version: '1.0',
    program_id: normalized.programId,
    program_title: normalized.programTitle,
  };

  const annotations: ProgramAnnotationsFile = {
    version: '1.0',
    chapters: {},
  };

  const questionBanksByChapter: Record<string, ProgramChapter> = {};

  let rankedTotalQuestionCount = 0;

  // First level folders under root are the "bank partition" chapters.
  for (const top of topFolders) {
    const chapterId = top.id;

    const chapter: ProgramChapter = {
      chapter_id: chapterId,
      title: top.title,
      regions: [],
      nodes: [],
    };

    const annChapter: NonNullable<ProgramAnnotationsFile['chapters'][string]> = {
      questionTypes: {},
      annotations: {},
    };
    annotations.chapters[chapterId] = annChapter;

    // Determine leaf folders within this top folder.
    // A "leaf folder" is the node at depth == spec.divisions.length under the root.
    // We treat that leaf as a "region" inside this chapter.
    walk(top, (n, path) => {
      // walk() is invoked with `top` as the starting node, so `path[0]` is the chapter.
      // That means:
      // - chapter itself => path.length === 1 => depthUnderTop === 0
      // - its direct child => path.length === 2 => depthUnderTop === 1
      const depthUnderTop = path.length - 1;
      if (depthUnderTop < 0) return;

      const isLeafFolder = depthUnderTop === normalized.divisions.length - 1;
      if (!isLeafFolder) return;

      const regionId = n.id;
      if (!chapter.regions!.some((r) => r.region_id === regionId)) {
        chapter.regions!.push({ region_id: regionId, section_title: n.title });
      }

      let treeOrder = 1;

      for (const qt of n.questionTypes) {
        const typeId = qt.id;
        if (!annChapter.questionTypes) annChapter.questionTypes = {};
        if (!annChapter.questionTypes[typeId]) {
          annChapter.questionTypes[typeId] = { title: qt.title, treeOrder };
          treeOrder += 1;
        }

        const qs = qt.jsonText.trim() ? parseQuestionTypeJson(qt.jsonText) : [];
        rankedTotalQuestionCount += qs.length;

        const nodeId = [chapterId, ...path.slice(1).map((x) => x.id), typeId].join('__');

        for (const q of qs) {
          if (!annChapter.annotations) annChapter.annotations = {};
          const key = `${nodeId}::${q.id}`;
          const hintsArr = Array.isArray(q.hint) ? q.hint : q.hint ? [q.hint] : [];

          const promptBlocks = Array.isArray(q.promptBlocks) && q.promptBlocks.length > 0 ? q.promptBlocks : undefined;
          const interaction: ProgramInteractionSpec | undefined = q.interaction
            ? q.interaction
            : (q.options.length >= 2
              ? ({ type: 'mcq', choices: q.options, correctChoiceIndex: q.correct_option_index } satisfies ProgramInteractionSpec)
              : undefined);

          annChapter.annotations[key] = {
            question_type_id: typeId,
            difficulty: q.difficulty,
            mcq: interaction && (interaction as any).type === 'mcq'
              ? { choices: (interaction as any).choices ?? q.options, correctChoiceIndex: (interaction as any).correctChoiceIndex ?? q.correct_option_index }
              : { choices: q.options, correctChoiceIndex: q.correct_option_index },
            interaction,
            prompt: promptBlocks ? { blocks: promptBlocks } : undefined,
            time_limit_seconds: q.time_required_seconds,
            points: q.points,
            solution: q.solution ? { raw_text: q.solution } : undefined,
            hints: hintsArr.length > 0 ? hintsArr.map((h) => ({ raw_text: String(h) })) : undefined,
          };
        }

        chapter.nodes!.push({
          node_id: nodeId,
          node_type: 'exercise',
          region_id: regionId,
          questions: qs.map((q) => ({
            question_id: q.id,
            raw_text: q.question,
            parts: [],
          })),
        });
      }
    });

    questionBanksByChapter[chapterId] = chapter;
  }

  return { toc, questionBanksByChapter, annotations, programMeta, rankedTotalQuestionCount };
}
