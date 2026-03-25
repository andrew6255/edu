export type ProgramDifficulty = 'easy' | 'medium' | 'hard';

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
        }
      >;
    }
  >;
};

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
  annotationKey: string;
  questionTypeId: string | null;
  difficulty: ProgramDifficulty | null;
  mcq: { choices: string[]; correctChoiceIndex: number } | null;
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
          annotationKey: key,
          questionTypeId: typeof a?.question_type_id === 'string' ? a.question_type_id : null,
          difficulty: (a?.difficulty as ProgramDifficulty) ?? null,
          mcq: a?.mcq && Array.isArray(a.mcq.choices) && typeof a.mcq.correctChoiceIndex === 'number' ? a.mcq : null,
        });
      } else {
        for (const p of parts) {
          const partId = String(p.part_id);
          const key = makeQuestionKey(nodeId, qid, partId);

          // Fallback: allow annotation at question-level if part-level missing
          const a = ann[key] ?? ann[makeQuestionKey(nodeId, qid, null)];

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
            annotationKey: key,
            questionTypeId: typeof a?.question_type_id === 'string' ? a.question_type_id : null,
            difficulty: (a?.difficulty as ProgramDifficulty) ?? null,
            mcq: a?.mcq && Array.isArray(a.mcq.choices) && typeof a.mcq.correctChoiceIndex === 'number' ? a.mcq : null,
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
