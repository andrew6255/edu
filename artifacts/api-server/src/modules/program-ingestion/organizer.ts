export type OrganizerNodeKind = "folder" | "category";
export type OrganizerDecision = "pending" | "approved" | "rejected" | "edited";
export type AnswerProvenance = "source" | "embedded_source" | "ai_generated" | "missing";

export interface OrganizerNode { id: string; title: string; kind: OrganizerNodeKind; children: OrganizerNode[] }
export type StructureOperation =
  | { id: string; type: "create_node"; parentId: string; node: OrganizerNode; decision: OrganizerDecision }
  | { id: string; type: "rename_node"; nodeId: string; title: string; decision: OrganizerDecision }
  | { id: string; type: "move_node"; nodeId: string; parentId: string; decision: OrganizerDecision }
  | { id: string; type: "reorder_node"; nodeId: string; index: number; decision: OrganizerDecision }
  | { id: string; type: "delete_node"; nodeId: string; decision: OrganizerDecision };
export interface PlacementProposal { id: string; questionId: string; destinationCategoryId: string; alternativeCategoryIds: string[]; confidence: number; rationale: string; decision: OrganizerDecision }
export interface OrganizerProposal { baseRevision: number; previewTree: OrganizerNode[]; operations: StructureOperation[]; placements: PlacementProposal[] }

export interface OrganizerQuestionInput {
  id: string;
  text: string;
  answerText?: string;
  flags?: string[];
}

export interface OrganizerRequest {
  programId: string;
  programSubject: string;
  baseRevision: number;
  currentTree: OrganizerNode[];
  incomingQuestions: OrganizerQuestionInput[];
  existingQuestions?: OrganizerQuestionInput[];
  preferences?: { namingLanguage?: string; maximumPreferredDepth?: number; minimumCategorySize?: number; customInstructions?: string };
}

export interface OrganizerQuestionAssessment {
  questionId: string;
  detectedSubject: string;
  subjectConfidence: number;
  likelyDuplicateQuestionId: string | null;
  duplicateConfidence: number;
}

export interface OrganizerResponse extends OrganizerProposal {
  summary: string;
  assessments: OrganizerQuestionAssessment[];
  provider: string;
}

function flatten(nodes: OrganizerNode[]): Map<string, OrganizerNode> {
  const result = new Map<string, OrganizerNode>();
  const visit = (node: OrganizerNode): void => {
    if (!node.id.trim()) throw new Error("Organizer node ID is required.");
    if (result.has(node.id)) throw new Error(`Duplicate organizer node ID: ${node.id}`);
    if (!node.title.trim()) throw new Error(`Organizer node ${node.id} must have a title.`);
    if (node.kind === "category" && node.children.length > 0) throw new Error(`Category ${node.id} is terminal and cannot contain children.`);
    result.set(node.id, node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

/** Deterministic safety boundary applied before any LLM proposal reaches a draft. */
export function validateOrganizerProposal(proposal: OrganizerProposal, expectedQuestionIds?: Set<string>): void {
  if (!Number.isInteger(proposal.baseRevision) || proposal.baseRevision < 0) throw new Error("baseRevision must be a non-negative integer.");
  const nodes = flatten(proposal.previewTree);
  const operationIds = new Set<string>();
  for (const operation of proposal.operations) {
    if (!operation.id.trim() || operationIds.has(operation.id)) throw new Error("Structure operation IDs must be non-empty and unique.");
    operationIds.add(operation.id);
  }
  const placementIds = new Set<string>();
  const placedQuestionIds = new Set<string>();
  for (const placement of proposal.placements) {
    if (!placement.id.trim() || placementIds.has(placement.id)) throw new Error("Placement proposal IDs must be non-empty and unique.");
    placementIds.add(placement.id);
    if (!placement.questionId.trim()) throw new Error("Placement questionId is required.");
    if (placedQuestionIds.has(placement.questionId)) throw new Error(`Question ${placement.questionId} has more than one placement.`);
    if (expectedQuestionIds && !expectedQuestionIds.has(placement.questionId)) throw new Error(`Placement references unknown question ${placement.questionId}.`);
    placedQuestionIds.add(placement.questionId);
    if (placement.confidence < 0 || placement.confidence > 1) throw new Error(`Placement ${placement.id} confidence must be between 0 and 1.`);
    const destination = nodes.get(placement.destinationCategoryId);
    if (!destination) throw new Error(`Placement ${placement.id} references an unknown destination.`);
    if (destination.kind !== "category") throw new Error(`Placement ${placement.id} destination must be a terminal category.`);
  }
  if (expectedQuestionIds) {
    for (const questionId of expectedQuestionIds) if (!placedQuestionIds.has(questionId)) throw new Error(`Question ${questionId} is missing a placement.`);
  }
}

export function requiresIndividualReview(input: { extractionConfidence: number; answerConfidence: number | null; placementConfidence: number; subjectConfidence: number; answerProvenance: AnswerProvenance; flags: string[]; likelyDuplicate: boolean }): boolean {
  return input.extractionConfidence < 0.85 || input.answerConfidence == null || input.answerConfidence < 0.85
    || input.placementConfidence < 0.8 || input.subjectConfidence < 0.85
    || input.answerProvenance === "ai_generated" || input.answerProvenance === "missing"
    || input.flags.length > 0 || input.likelyDuplicate;
}
