import type { TocData } from '@/lib/programMaps';
import {
  type ProgramAnnotationsFile,
  type ProgramChapter,
  type ProgramDifficulty,
  type ProgramMetaFile,
  parseJsonText,
} from '@/lib/programQuestionBank';

export type NestedProgram = {
  program_id: string;
  book_name: string;
  version?: string;
  defaults?: {
    time_required_seconds?: number;
    points?: number;
  };
  chapters: Array<{
    chapter_id: string;
    chapter_name: string;
    subsections: Array<{
      subsection_id: string;
      subsection_name: string;
      question_types: Array<{
        type_id: string;
        type_name: string;
        kind?: 'mcq' | string;
        questions: Array<{
          id: string;
          question: string;
          options: string[];
          correct_option_index: number;
          difficulty: ProgramDifficulty;
          time_required_seconds?: number;
          hint?: string | string[] | null;
          solution?: string | null;
          points?: number;
        }>;
      }>;
    }>;
  }>;
};

function mustString(x: unknown, label: string): string {
  const s = typeof x === 'string' ? x : String(x ?? '');
  if (!s.trim()) throw new Error(`Missing ${label}`);
  return s;
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v));
}

export function parseNestedProgramJson(text: string): NestedProgram {
  const raw = parseJsonText<unknown>(text, 'nested program');
  if (!raw || typeof raw !== 'object') throw new Error('Nested program must be a JSON object');
  const p = raw as any;

  const program_id = mustString(p.program_id ?? p.id ?? p.programId, 'program_id');
  const book_name = mustString(p.book_name ?? p.bookName ?? p.title, 'book_name');

  const chaptersRaw = p.chapters;
  if (!Array.isArray(chaptersRaw)) throw new Error('Nested program chapters must be an array');

  const chapters = chaptersRaw.map((c: any, ci: number) => {
    const chapter_id = mustString(c.chapter_id ?? c.id ?? `chapter_${ci + 1}`, 'chapter_id');
    const chapter_name = mustString(c.chapter_name ?? c.name ?? c.title, 'chapter_name');
    const subsRaw = c.subsections;
    if (!Array.isArray(subsRaw)) throw new Error(`Chapter ${chapter_id} subsections must be an array`);

    const subsections = subsRaw.map((s: any, si: number) => {
      const subsection_id = mustString(s.subsection_id ?? s.id ?? `subsection_${si + 1}`, 'subsection_id');
      const subsection_name = mustString(s.subsection_name ?? s.name ?? s.title, 'subsection_name');
      const typesRaw = s.question_types;
      if (!Array.isArray(typesRaw)) throw new Error(`Subsection ${subsection_id} question_types must be an array`);

      const question_types = typesRaw.map((t: any, ti: number) => {
        const type_id = mustString(t.type_id ?? t.id ?? `type_${ti + 1}`, 'type_id');
        const type_name = mustString(t.type_name ?? t.name ?? t.title ?? type_id, 'type_name');
        const kind = typeof t.kind === 'string' ? t.kind : 'mcq';
        const qsRaw = t.questions;
        if (!Array.isArray(qsRaw)) throw new Error(`Question type ${type_id} questions must be an array`);

        const questions = qsRaw.map((q: any, qi: number) => {
          const id = mustString(q.id ?? `q_${qi + 1}`, 'question.id');
          const question = mustString(q.question ?? q.prompt, 'question.question');
          const options = asStringArray(q.options);
          if (options.length < 2) throw new Error(`Question ${id} must have at least 2 options`);
          const correct_option_index = Number(q.correct_option_index);
          if (!Number.isFinite(correct_option_index) || correct_option_index < 0 || correct_option_index >= options.length) {
            throw new Error(`Question ${id} has invalid correct_option_index`);
          }
          const difficulty = q.difficulty as ProgramDifficulty;
          if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') {
            throw new Error(`Question ${id} has invalid difficulty`);
          }
          return {
            id,
            question,
            options,
            correct_option_index,
            difficulty,
            time_required_seconds: q.time_required_seconds != null ? Number(q.time_required_seconds) : undefined,
            hint: q.hint ?? null,
            solution: q.solution ?? null,
            points: q.points != null ? Number(q.points) : undefined,
          };
        });

        return { type_id, type_name, kind, questions };
      });

      return { subsection_id, subsection_name, question_types };
    });

    return { chapter_id, chapter_name, subsections };
  });

  return {
    program_id,
    book_name,
    version: typeof p.version === 'string' ? p.version : undefined,
    defaults: p.defaults && typeof p.defaults === 'object' ? p.defaults : undefined,
    chapters,
  };
}

export function convertNestedProgramToInternal(p: NestedProgram): {
  toc: TocData;
  questionBanksByChapter: Record<string, ProgramChapter>;
  annotations: ProgramAnnotationsFile;
  programMeta: ProgramMetaFile;
} {
  const toc: TocData = {
    program_id: p.program_id,
    program_title: p.book_name,
    toc_tree: p.chapters.map((ch, idx) => ({
      id: ch.chapter_id,
      title: ch.chapter_name,
      level: 1,
      children: ch.subsections.map((s) => ({
        id: s.subsection_id,
        title: s.subsection_name,
        level: 2,
        children: [],
      })),
    })),
    toc_notes: [],
  };

  const programMeta: ProgramMetaFile = {
    version: p.version ?? '1.0',
    program_id: p.program_id,
    program_title: p.book_name,
    defaults: {
      time_limit_seconds: p.defaults?.time_required_seconds,
      points: p.defaults?.points,
    },
  };

  const annotations: ProgramAnnotationsFile = {
    version: '1.0',
    chapters: {},
  };

  const questionBanksByChapter: Record<string, ProgramChapter> = {};

  for (const ch of p.chapters) {
    const chapter: ProgramChapter = {
      chapter_id: ch.chapter_id,
      title: ch.chapter_name,
      regions: ch.subsections.map((s) => ({
        region_id: s.subsection_id,
        section_title: s.subsection_name,
      })),
      nodes: [],
    };

    const annChapter: NonNullable<ProgramAnnotationsFile['chapters'][string]> = {
      questionTypes: {},
      annotations: {},
    };
    annotations.chapters[ch.chapter_id] = annChapter;

    let treeOrder = 1;

    for (const s of ch.subsections) {
      for (const t of s.question_types) {
        if (!annChapter.questionTypes || !annChapter.questionTypes[t.type_id]) {
          if (!annChapter.questionTypes) annChapter.questionTypes = {};
          annChapter.questionTypes[t.type_id] = { title: t.type_name, treeOrder };
          treeOrder += 1;
        }

        const nodeId = `${ch.chapter_id}__${s.subsection_id}__${t.type_id}`;

        const nodeQuestions: Array<any> = t.questions.map((q) => {
          const qid = String(q.id);

          const annotationKey = `${nodeId}::${qid}`;
          const hintsArr = Array.isArray(q.hint) ? q.hint : (q.hint ? [q.hint] : []);

          if (!annChapter.annotations) annChapter.annotations = {};
          annChapter.annotations[annotationKey] = {
            question_type_id: t.type_id,
            difficulty: q.difficulty,
            mcq: { choices: q.options, correctChoiceIndex: q.correct_option_index },
            time_limit_seconds: q.time_required_seconds,
            points: q.points,
            solution: q.solution ? { raw_text: q.solution } : undefined,
            hints: hintsArr.length > 0 ? hintsArr.map((h) => ({ raw_text: String(h) })) : undefined,
          };

          return {
            question_id: qid,
            raw_text: q.question,
            parts: [],
          };
        });

        chapter.nodes!.push({
          node_id: nodeId,
          node_type: 'exercise',
          region_id: s.subsection_id,
          questions: nodeQuestions,
        });
      }
    }

    questionBanksByChapter[ch.chapter_id] = chapter;
  }

  return { toc, questionBanksByChapter, annotations, programMeta };
}
