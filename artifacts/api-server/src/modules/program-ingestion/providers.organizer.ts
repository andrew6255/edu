import { logger } from '../../lib/logger';
import { validateOrganizerProposal, type OrganizerNode, type OrganizerRequest, type OrganizerResponse } from './organizer';

function parseJson(text: string): unknown {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced?.[1] ?? text.trim());
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2));
}

function similarity(a: string, b: string): number {
  const left = tokens(a); const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

function categories(nodes: OrganizerNode[]): OrganizerNode[] {
  return nodes.flatMap(node => node.kind === 'category' ? [node] : categories(node.children));
}

function isAlgebraicExpressionBatch(input: OrganizerRequest): boolean {
  return /\b(expand|expansion|factor|factorise|factorize|factorisation|factorization|polynomial|algebraic expression)\b/.test(input.incomingQuestions.map(question => question.text).join(' ').toLowerCase());
}

export class DeterministicOrganizerProvider {
  readonly name = 'deterministic_organizer';
  async organize(input: OrganizerRequest): Promise<OrganizerResponse> {
    const available = categories(input.currentTree);
    const isAlgebraicExpressions = isAlgebraicExpressionBatch(input);
    if (isAlgebraicExpressions) {
      const now = Date.now().toString(36);
      const algebraFolder = input.currentTree.find(node => node.kind === 'folder' && /\balgebra\b/i.test(node.title));
      const expressionCategory: OrganizerNode = { id: `category_algebraic_expressions_${now}`, title: 'Expansion and Factorization', kind: 'category', children: [] };
      const expressionFolder: OrganizerNode = { id: `folder_algebraic_expressions_${now}`, title: 'Algebraic Expressions', kind: 'folder', children: [expressionCategory] };
      const algebraNode: OrganizerNode = algebraFolder
        ? { ...algebraFolder, children: [...algebraFolder.children, expressionFolder] }
        : { id: `folder_algebra_${now}`, title: 'Algebra', kind: 'folder', children: [expressionFolder] };
      const previewTree = algebraFolder
        ? input.currentTree.map(node => node.id === algebraFolder.id ? algebraNode : node)
        : [...input.currentTree, algebraNode];
      const operations = algebraFolder
        ? [{ id: `create_expressions_${now}`, type: 'create_node' as const, parentId: algebraFolder.id, node: expressionFolder, decision: 'pending' as const }]
        : [{ id: `create_algebra_${now}`, type: 'create_node' as const, parentId: 'root', node: algebraNode, decision: 'pending' as const }];
      const existing = input.existingQuestions ?? [];
      const response: OrganizerResponse = {
        baseRevision: input.baseRevision,
        previewTree,
        operations,
        placements: input.incomingQuestions.map(question => ({ id: `placement_${question.id}`, questionId: question.id, destinationCategoryId: expressionCategory.id, alternativeCategoryIds: [], confidence: 0.92, rationale: 'Expansion and factorization belong to algebraic expressions, not combinatorics.', decision: 'pending' })),
        assessments: input.incomingQuestions.map(question => {
          const best = existing.map(candidate => ({ id: candidate.id, score: similarity(question.text, candidate.text) })).sort((a, b) => b.score - a.score)[0];
          return { questionId: question.id, detectedSubject: input.programSubject, subjectConfidence: 0.9, likelyDuplicateQuestionId: best && best.score >= 0.82 ? best.id : null, duplicateConfidence: best?.score ?? 0 };
        }),
        summary: 'Created an Algebraic Expressions branch for expansion and factorization questions.',
        provider: this.name,
      };
      validateOrganizerProposal(response, new Set(input.incomingQuestions.map(question => question.id)));
      return response;
    }
    const fallbackCategory: OrganizerNode = { id: `category_${Date.now().toString(36)}`, title: 'Imported Questions', kind: 'category', children: [] };
    const previewTree = available.length ? input.currentTree : [{ id: `folder_${Date.now().toString(36)}`, title: input.programSubject, kind: 'folder', children: [fallbackCategory] } as OrganizerNode];
    const destination = available[0] ?? fallbackCategory;
    const existing = input.existingQuestions ?? [];
    const assessments = input.incomingQuestions.map(question => {
      const best = existing.map(candidate => ({ id: candidate.id, score: similarity(question.text, candidate.text) })).sort((a, b) => b.score - a.score)[0];
      return { questionId: question.id, detectedSubject: input.programSubject, subjectConfidence: 0.5, likelyDuplicateQuestionId: best && best.score >= 0.82 ? best.id : null, duplicateConfidence: best?.score ?? 0 };
    });
    const response: OrganizerResponse = {
      baseRevision: input.baseRevision,
      previewTree,
      operations: available.length ? [] : [{ id: 'create_import_folder', type: 'create_node', parentId: 'root', node: previewTree[0]!, decision: 'pending' }],
      placements: input.incomingQuestions.map(question => ({ id: `placement_${question.id}`, questionId: question.id, destinationCategoryId: destination.id, alternativeCategoryIds: [], confidence: 0.45, rationale: 'Fallback placement requires administrator review.', decision: 'pending' })),
      assessments,
      summary: 'Fallback organizer created a conservative import location. Review all placements.',
      provider: this.name,
    };
    validateOrganizerProposal(response, new Set(input.incomingQuestions.map(question => question.id)));
    return response;
  }
}

export class GeminiOrganizerProvider {
  readonly name = 'gemini_program_organizer';
  async organize(input: OrganizerRequest): Promise<OrganizerResponse> {
    // A deterministic taxonomy guard prevents semantic drift into an attractive
    // but unrelated existing category such as combinations/permutations.
    if (isAlgebraicExpressionBatch(input)) return new DeterministicOrganizerProvider().organize(input);
    const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['VITE_GEMINI_API_KEY'];
    if (!apiKey) return new DeterministicOrganizerProvider().organize(input);
    const model = process.env['PROGRAM_INGESTION_GEMINI_MODEL'] ?? 'gemini-2.0-flash';
    const prompt = `You organize a single-subject educational program. Return JSON only.\n\nPROGRAM SUBJECT: ${input.programSubject}\nBASE REVISION: ${input.baseRevision}\nCURRENT TREE: ${JSON.stringify(input.currentTree)}\nINCOMING QUESTIONS: ${JSON.stringify(input.incomingQuestions)}\nEXISTING QUESTIONS FOR DUPLICATE CHECK: ${JSON.stringify(input.existingQuestions ?? [])}\nPREFERENCES: ${JSON.stringify(input.preferences ?? {})}\n\nReturn: {"summary":string,"previewTree":OrganizerNode[],"operations":StructureOperation[],"placements":PlacementProposal[],"assessments":Assessment[]}. OrganizerNode is {id,title,kind:"folder"|"category",children}. Categories are terminal. Keep stable IDs for existing nodes. New IDs must be unique. Siblings must represent comparable semantic levels. Analyze the mathematical concept of the whole batch before considering existing folders. Never place algebraic expansion, polynomial expansion, or factorization under combinations, permutations, counting, probability, or combinatorics; create/use Algebra > Algebraic Expressions > Expansion and Factorization. Create a new semantically correct branch when existing branches do not match. Propose useful flexible-depth branches and categories, but avoid unnecessary one-item depth. Questions may only target categories. Each placement must use an incoming question ID and include confidence 0..1, rationale, alternativeCategoryIds, decision:"pending". Each assessment must include questionId, detectedSubject, subjectConfidence 0..1, likelyDuplicateQuestionId or null, duplicateConfidence 0..1. Flag true subject mismatches; branches within the subject are not mismatches. Operations use create_node, rename_node, move_node, or reorder_node and decision:"pending". Include baseRevision:${input.baseRevision}.`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }, contents: [{ role: 'user', parts: [{ text: prompt }] }] }) });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Organizer request failed; using deterministic fallback');
      return new DeterministicOrganizerProvider().organize(input);
    }
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('\n');
    if (!text) return new DeterministicOrganizerProvider().organize(input);
    try {
      const parsed = parseJson(text) as Omit<OrganizerResponse, 'provider'>;
      const result: OrganizerResponse = { ...parsed, baseRevision: input.baseRevision, provider: this.name };
      if (!Array.isArray(result.assessments) || result.assessments.length !== input.incomingQuestions.length) throw new Error('Organizer assessments are incomplete.');
      validateOrganizerProposal(result, new Set(input.incomingQuestions.map(question => question.id)));
      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Invalid organizer response; using deterministic fallback');
      return new DeterministicOrganizerProvider().organize(input);
    }
  }
}

export function getOrganizerProvider() { return new GeminiOrganizerProvider(); }
