export type ProgramDifficulty = 'easy' | 'medium' | 'hard';

export type ProgramPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'math'; latex: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'table'; rows: string[][]; headerRows?: number };

export type ProgramExplanationScene = {
  id: string;
  title: string;
  narration?: string | null;
  beforeText?: string | null;
  afterText?: string | null;
  emphasis?: string[];
  action?: 'highlight' | 'transform' | 'note' | 'reveal';
};

export type ProgramAtomicInteractionSpec =
  | { type: 'mcq'; choices: string[]; correctChoiceIndex: number }
  | { type: 'numeric'; correct: number | number[]; tolerance?: number; format?: 'integer' | 'decimal' | 'fraction'; keypad?: 'basic' | 'scientific' }
  | { type: 'text'; accepted: string[]; caseSensitive?: boolean; trim?: boolean }
  | { type: 'line_equation'; forms: string[]; variable?: string; caseSensitive?: boolean; trim?: boolean }
  | { type: 'point_list'; points: Array<{ x: number; y: number }>; minPoints?: number; maxPoints?: number; ordered?: boolean; allowEquivalentOrder?: boolean }
  | { type: 'points_on_line'; lineForms: string[]; minPoints: number; maxPoints?: number; disallowGivenPoints?: Array<{ x: number; y: number }>; requireDistinct?: boolean }
  | { type: 'freeform'; grading: 'ai' | 'manual'; placeholder?: string; rubricSummary?: string | null; acceptSteps?: boolean };

export type ProgramStepSpec = {
  id: string;
  title: string;
  prompt?: ProgramPromptBlock[];
  interaction: ProgramAtomicInteractionSpec;
  explanation?: string | null;
};

export type ProgramInteractionSpec =
  | ProgramAtomicInteractionSpec
  | {
      type: 'composite';
      final: ProgramAtomicInteractionSpec;
      steps: ProgramStepSpec[];
      allowDirectFinalAnswer?: boolean;
      scoreStrategy?: 'final_only' | 'final_plus_steps';
    };

export type ProgramChapter = {
  chapter_id: string;
  title?: string | null;
  regions?: Array<{
    region_id: string;
    section_label?: string | null;
    section_title: string;
    theme_name?: string | null;
  }>;
  nodes?: Array<{
    node_id: string;
    node_type: string;
    region_id?: string | null;
    textbook_ref?: string | null;
    tags?: string[];
    questions?: Array<{
      question_id: string;
      raw_text?: string | null;
      latex?: string | null;
      parts?: Array<{
        part_id: string;
        raw_text?: string | null;
        latex?: string | null;
      }>;
      source_ref?: unknown;
      hint_refs?: unknown;
    }>;
  }>;
};

export type ProgramAnnotationsFile = {
  version: string;
  chapters: Record<
    string,
    {
      questionTypes?: Record<string, { title: string; treeOrder: number }>;
      annotations?: Record<
        string,
        {
          question_type_id?: string;
          difficulty?: ProgramDifficulty;
          mcq?: { choices: string[]; correctChoiceIndex: number };
          interaction?: ProgramInteractionSpec;
          prompt?: { blocks: ProgramPromptBlock[] };
          time_limit_seconds?: number;
          points?: number;
          solution?: { raw_text?: string | null; latex?: string | null };
          hints?: Array<{ raw_text?: string | null; latex?: string | null }>;
          explanationScenes?: ProgramExplanationScene[];
          stepSolutions?: Array<{
            id: string;
            title: string;
            prompt?: { blocks: ProgramPromptBlock[] };
            interaction: ProgramAtomicInteractionSpec;
            explanation?: { raw_text?: string | null; latex?: string | null };
          }>;
        }
      >;
    }
  >;
};

export type ProgramMetaFile = {
  version: string;
  program_id: string;
  program_title?: string | null;
  divisions?: string[];
  defaults?: {
    time_limit_seconds?: number;
    points?: number;
  };
};

export function parseJsonText<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid ${label} JSON: ${msg}`);
  }
}

export function isProgramChapter(x: unknown): x is ProgramChapter {
  if (!x || typeof x !== 'object') return false;
  const c = x as any;
  if (typeof c.chapter_id !== 'string' && typeof c.chapter_id !== 'number') return false;
  if (c.nodes != null && !Array.isArray(c.nodes)) return false;
  return true;
}

export function isProgramAnnotationsFile(x: unknown): x is ProgramAnnotationsFile {
  if (!x || typeof x !== 'object') return false;
  const a = x as any;
  if (typeof a.version !== 'string') return false;
  if (!a.chapters || typeof a.chapters !== 'object') return false;
  return true;
}

export function isProgramMetaFile(x: unknown): x is ProgramMetaFile {
  if (!x || typeof x !== 'object') return false;
  const m = x as any;
  if (typeof m.version !== 'string') return false;
  if (typeof m.program_id !== 'string') return false;
  return true;
}

export type FlatProgramQuestion = {
  id: string;
  chapterId: string;
  regionId: string | null;
  nodeId: string;
  nodeType: string;
  questionId: string;
  partId: string | null;
  stemRawText: string | null;
  stemLatex: string | null;
  partRawText: string | null;
  partLatex: string | null;
  promptRawText: string | null;
  promptLatex: string | null;
  promptBlocks: ProgramPromptBlock[] | null;
  annotationKey: string;
  questionTypeId: string | null;
  difficulty: ProgramDifficulty | null;
  mcq: { choices: string[]; correctChoiceIndex: number } | null;
  interaction: ProgramInteractionSpec | null;
  solutionText: string | null;
  hints: string[];
  explanationScenes: ProgramExplanationScene[];
  stepSolutions: ProgramStepSpec[];
};

function getText(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x : null;
}

export function makeQuestionKey(nodeId: string, questionId: string, partId?: string | null): string {
  const base = `${nodeId}::${questionId}`;
  if (partId && String(partId).trim()) return `${base}::${partId}`;

  return base;
}

export function flattenProgramChapter(
  chapter: ProgramChapter,
  annotations: ProgramAnnotationsFile | null
): {
  chapterId: string;
  regions: Array<{ regionId: string; title: string; label: string | null; theme: string | null }>;
  questionTypes: Array<{ id: string; title: string; treeOrder: number }>;
  questions: FlatProgramQuestion[];
} {
  const chapterId = String(chapter.chapter_id);
  const annChapter = annotations?.chapters?.[chapterId];
  const typeDefs = annChapter?.questionTypes ?? {};
  const ann = annChapter?.annotations ?? {};

  const regions = (chapter.regions ?? []).map((r) => ({
    regionId: String(r.region_id),
    title: String(r.section_title ?? r.region_id),
    label: getText(r.section_label),
    theme: getText(r.theme_name),
  }));

  const questionTypes = Object.entries(typeDefs)
    .map(([id, v]) => ({ id, title: String(v.title ?? id), treeOrder: Number(v.treeOrder ?? 999) }))
    .sort((a, b) => a.treeOrder - b.treeOrder);

  const questions: FlatProgramQuestion[] = [];
  for (const node of chapter.nodes ?? []) {
    const nodeId = String(node.node_id);
    const regionId = node.region_id ? String(node.region_id) : null;
    const nodeType = String(node.node_type ?? 'node');

    for (const q of node.questions ?? []) {
      const qid = String(q.question_id);
      const stemRaw = getText(q.raw_text);
      const stemLatex = getText(q.latex);
      const parts = Array.isArray(q.parts) ? q.parts : [];

      // Parts become separate questions (Option 1). If no parts, make a single item.
      if (parts.length === 0) {
        const key = makeQuestionKey(nodeId, qid, null);
        const a = ann[key];
        const promptBlocks = Array.isArray((a as any)?.prompt?.blocks) ? (((a as any).prompt.blocks as unknown[]) as ProgramPromptBlock[]) : null;
        const interaction: ProgramInteractionSpec | null =
          (a as any)?.interaction && typeof (a as any).interaction === 'object'
            ? ((a as any).interaction as ProgramInteractionSpec)
            : (a?.mcq && Array.isArray(a.mcq.choices) && typeof a.mcq.correctChoiceIndex === 'number'
              ? ({ type: 'mcq', choices: a.mcq.choices, correctChoiceIndex: a.mcq.correctChoiceIndex } satisfies ProgramInteractionSpec)
              : null);
        questions.push({
          id: key,
          chapterId,
          regionId,
          nodeId,
          nodeType,
          questionId: qid,
          partId: null,
          stemRawText: stemRaw,
          stemLatex,
          partRawText: null,
          partLatex: null,
          promptRawText: stemRaw,
          promptLatex: stemLatex,
          promptBlocks,
          annotationKey: key,
          questionTypeId: typeof a?.question_type_id === 'string' ? a.question_type_id : null,
          difficulty: (a?.difficulty as ProgramDifficulty) ?? null,
          mcq: a?.mcq && Array.isArray(a.mcq.choices) && typeof a.mcq.correctChoiceIndex === 'number' ? a.mcq : null,
          interaction,
          solutionText: getText(a?.solution?.raw_text) ?? getText(a?.solution?.latex),
          hints: Array.isArray(a?.hints) ? a.hints.map((h) => getText(h?.raw_text) ?? getText(h?.latex)).filter(Boolean) as string[] : [],
          explanationScenes: Array.isArray((a as any)?.explanationScenes)
            ? ((a as any).explanationScenes as Array<Record<string, unknown>>).map((scene, idx) => ({
                id: typeof scene?.id === 'string' ? scene.id : `scene_${idx + 1}`,
                title: typeof scene?.title === 'string' && scene.title.trim() ? scene.title : `Step ${idx + 1}`,
                narration: getText(scene?.narration),
                beforeText: getText(scene?.beforeText),
                afterText: getText(scene?.afterText),
                emphasis: Array.isArray(scene?.emphasis) ? scene.emphasis.map((item) => String(item)).filter(Boolean) : undefined,
                action: scene?.action === 'highlight' || scene?.action === 'transform' || scene?.action === 'note' || scene?.action === 'reveal'
                  ? scene.action
                  : undefined,
              }))
            : [],
          stepSolutions: Array.isArray((a as any)?.stepSolutions)
            ? ((a as any).stepSolutions as Array<Record<string, unknown>>).map((step, idx) => ({
                id: typeof step?.id === 'string' ? step.id : `step_${idx + 1}`,
                title: typeof step?.title === 'string' ? step.title : `Step ${idx + 1}`,
                prompt: Array.isArray((step?.prompt as { blocks?: unknown } | undefined)?.blocks)
                  ? (((step?.prompt as { blocks?: unknown[] }).blocks ?? []) as ProgramPromptBlock[])
                  : undefined,
                interaction: step?.interaction as ProgramAtomicInteractionSpec,
                explanation: getText((step?.explanation as { raw_text?: unknown; latex?: unknown } | undefined)?.raw_text)
                  ?? getText((step?.explanation as { raw_text?: unknown; latex?: unknown } | undefined)?.latex),
              }))
            : [],
        });
      } else {
        for (const p of parts) {
          const partId = String(p.part_id);
          const key = makeQuestionKey(nodeId, qid, partId);

          // Fallback: allow annotation at question-level if part-level missing
          const a = ann[key] ?? ann[makeQuestionKey(nodeId, qid, null)];

          const promptBlocks = Array.isArray((a as any)?.prompt?.blocks) ? (((a as any).prompt.blocks as unknown[]) as ProgramPromptBlock[]) : null;
          const interaction: ProgramInteractionSpec | null =
            (a as any)?.interaction && typeof (a as any).interaction === 'object'
              ? ((a as any).interaction as ProgramInteractionSpec)
              : (a?.mcq && Array.isArray(a.mcq.choices) && typeof a.mcq.correctChoiceIndex === 'number'
                ? ({ type: 'mcq', choices: a.mcq.choices, correctChoiceIndex: a.mcq.correctChoiceIndex } satisfies ProgramInteractionSpec)
                : null);

          const partRaw = getText(p.raw_text);
          const partLatex = getText(p.latex);

          const promptRaw = [stemRaw, partRaw].filter(Boolean).join('\n');
          const promptLatex = [stemLatex, partLatex].filter(Boolean).join('\\n');

          questions.push({
            id: key,
            chapterId,
            regionId,
            nodeId,
            nodeType,
            questionId: qid,
            partId,
            stemRawText: stemRaw,
            stemLatex,
            partRawText: partRaw,
            partLatex,
            promptRawText: promptRaw || null,
            promptLatex: promptLatex || null,
            promptBlocks,
            annotationKey: key,
            questionTypeId: typeof a?.question_type_id === 'string' ? a.question_type_id : null,
            difficulty: (a?.difficulty as ProgramDifficulty) ?? null,
            mcq: a?.mcq && Array.isArray(a.mcq.choices) && typeof a.mcq.correctChoiceIndex === 'number' ? a.mcq : null,
            interaction,
            solutionText: getText(a?.solution?.raw_text) ?? getText(a?.solution?.latex),
            hints: Array.isArray(a?.hints) ? a.hints.map((h) => getText(h?.raw_text) ?? getText(h?.latex)).filter(Boolean) as string[] : [],
            explanationScenes: Array.isArray((a as any)?.explanationScenes)
              ? ((a as any).explanationScenes as Array<Record<string, unknown>>).map((scene, idx) => ({
                  id: typeof scene?.id === 'string' ? scene.id : `scene_${idx + 1}`,
                  title: typeof scene?.title === 'string' && scene.title.trim() ? scene.title : `Step ${idx + 1}`,
                  narration: getText(scene?.narration),
                  beforeText: getText(scene?.beforeText),
                  afterText: getText(scene?.afterText),
                  emphasis: Array.isArray(scene?.emphasis) ? scene.emphasis.map((item) => String(item)).filter(Boolean) : undefined,
                  action: scene?.action === 'highlight' || scene?.action === 'transform' || scene?.action === 'note' || scene?.action === 'reveal'
                    ? scene.action
                    : undefined,
                }))
              : [],
            stepSolutions: Array.isArray((a as any)?.stepSolutions)
              ? ((a as any).stepSolutions as Array<Record<string, unknown>>).map((step, idx) => ({
                  id: typeof step?.id === 'string' ? step.id : `step_${idx + 1}`,
                  title: typeof step?.title === 'string' ? step.title : `Step ${idx + 1}`,
                  prompt: Array.isArray((step?.prompt as { blocks?: unknown } | undefined)?.blocks)
                    ? (((step?.prompt as { blocks?: unknown[] }).blocks ?? []) as ProgramPromptBlock[])
                    : undefined,
                  interaction: step?.interaction as ProgramAtomicInteractionSpec,
                  explanation: getText((step?.explanation as { raw_text?: unknown; latex?: unknown } | undefined)?.raw_text)
                    ?? getText((step?.explanation as { raw_text?: unknown; latex?: unknown } | undefined)?.latex),
                }))
              : [],
          });
        }
      }
    }
  }

  return { chapterId, regions, questionTypes, questions };
}

export async function fetchProgramChapterFromPublic(path: string): Promise<ProgramChapter> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load chapter JSON: ${path}`);
  return (await res.json()) as ProgramChapter;
}

export async function fetchProgramAnnotationsFromPublic(path: string): Promise<ProgramAnnotationsFile> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load annotations JSON: ${path}`);
  return (await res.json()) as ProgramAnnotationsFile;
}
