import type { ExtractedDocument } from "./extractionTypes";

export type IngestionJobStatus =
  | "uploaded"
  | "extracting"
  | "auditing"
  | "structuring"
  | "segmenting"
  | "normalizing"
  | "reviewing"
  | "ready"
  | "failed"
  | "published";

export type IngestionDraftStatus =
  | "draft"
  | "needs_review"
  | "ready_to_publish"
  | "published";

export type ProgramVisibility = "public" | "private";

export type ExtractionQuality = "high" | "medium" | "low";

export type ReviewStatus = "ai_ok" | "needs_review" | "fixed_by_admin";

export type ReviewFlag =
  | "low_ocr_confidence"
  | "unreadable_region"
  | "missing_diagram"
  | "ambiguous_question_split"
  | "ambiguous_answer"
  | "multi_part_unclear"
  | "manual_verification_recommended";

export type QuestionKind =
  | "mcq_single"
  | "mcq_multi"
  | "true_false"
  | "numeric_exact"
  | "numeric_tolerance"
  | "short_text"
  | "expression_equivalence"
  | "equation_input"
  | "fill_blank"
  | "ordered_steps"
  | "multi_part"
  | "open_response_ai";

export type PromptBlock =
  | { type: "text"; text: string }
  | { type: "latex"; text: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "note"; text: string };

export type DeterministicAnswerSpec =
  | {
      type: "choice";
      choices: string[];
      correctChoiceIndex: number;
    }
  | {
      type: "number";
      correct: Array<number | string>;
      tolerance?: number;
    }
  | {
      type: "text";
      accepted: string[];
      caseSensitive?: boolean;
      trim?: boolean;
    }
  | {
      type: "line_equation";
      forms: string[];
      variable?: string;
      caseSensitive?: boolean;
      trim?: boolean;
    }
  | {
      type: "point_list";
      points: Array<{ x: number; y: number }>;
      minPoints?: number;
      maxPoints?: number;
      ordered?: boolean;
      allowEquivalentOrder?: boolean;
    }
  | {
      type: "points_on_line";
      lineForms: string[];
      minPoints: number;
      maxPoints?: number;
      disallowGivenPoints?: Array<{ x: number; y: number }>;
      requireDistinct?: boolean;
    };

export interface QuestionSolutionStep {
  id: string;
  title: string;
  prompt: PromptBlock[];
  answer: DeterministicAnswerSpec;
  explanation?: string;
}

export interface ExplanationScene {
  id: string;
  title: string;
  narration?: string;
  beforeText?: string;
  afterText?: string;
  emphasis?: string[];
  action?: "highlight" | "transform" | "note" | "reveal";
}

export type ExtractionWarningCode =
  | "low_quality_scan"
  | "ocr_unreadable_region"
  | "missing_diagram"
  | "ambiguous_question_split"
  | "ambiguous_answer"
  | "handwriting_detected";

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  severity: "info" | "warning" | "error";
  page?: number;
  regionId?: string;
  message: string;
}

export interface PageExtractionStatus {
  page: number;
  quality: ExtractionQuality;
  readable: boolean;
  issues: string[];
}

export interface ProgramNode {
  id: string;
  type: "topic" | "chapter" | "section" | "question_group";
  title: string;
  children: ProgramNode[];
  questionRefs?: string[];
  questionTypeTitle?: string;
}

export interface AiExtractionAudit {
  titleGuess?: string;
  subjectGuess: "mathematics" | "unknown";
  quality: ExtractionQuality;
  pages: PageExtractionStatus[];
  warnings: ExtractionWarning[];
  containsDiagrams: boolean;
  containsTables: boolean;
  containsHandwriting: boolean;
  recommendedNextAction: "continue" | "needs_admin_review";
}

export interface IngestionJob {
  id: string;
  adminUserId: string;
  classId: string | null;
  visibility: ProgramVisibility;
  status: IngestionJobStatus;
  stage: string | null;
  sourceFilePath: string;
  sourceFileName: string;
  providerMeta: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StructuredDraftTopicSuggestion {
  title: string;
  questionTypeTitle: string;
  questionIds: string[];
}

export interface StructuredDraftChapterSuggestion {
  title: string;
  topics: StructuredDraftTopicSuggestion[];
}

export interface StructuredDraftSuggestion {
  title: string;
  divisions: string[];
  chapters: StructuredDraftChapterSuggestion[];
  summary?: string;
}

export interface AiQuestionAnalysis {
  detectedKind: QuestionKind;
  confidence: number;
  isMultiPart: boolean;
  needsDiagram: boolean;
  autoGradable: boolean;
  recommendedGradingMode: "deterministic" | "step_based" | "ai_rubric";
  warnings: string[];
  normalizedQuestion: Question | null;
}

export interface IngestionDraft {
  id: string;
  jobId: string;
  title: string;
  subject: "mathematics";
  gradeBand: string | null;
  visibility: ProgramVisibility;
  classId: string | null;
  draftStatus: IngestionDraftStatus;
  extractedDocument: ExtractedDocument | null;
  extractionReport: AiExtractionAudit | null;
  hierarchy: ProgramNode[];
  aiSessionMeta: {
    model?: string;
    lastRunAt?: string;
    summary?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedQuestionBlock {
  id: string;
  page: number;
  questionLabel?: string;
  rawText: string;
  regionIds: string[];
  imagePaths?: string[];
  scanConfidence?: number;
  splitConfidence?: number;
  notes?: string[];
}

export interface QuestionBase {
  id: string;
  kind: QuestionKind;
  source: {
    page: number;
    questionLabel?: string;
    regionIds?: string[];
    extractedFromScan: boolean;
    confidence: number;
    unreadableParts?: string[];
  };
  prompt: PromptBlock[];
  skills?: string[];
  difficulty?: "easy" | "medium" | "hard";
  tags?: string[];
  hints?: string[];
  explanation?: string;
  answerData: {
    final: DeterministicAnswerSpec | null;
    finalAnswerText: string;
    solution: string;
    steps?: QuestionSolutionStep[];
    explanationScenes?: ExplanationScene[];
    allowDirectFinalAnswer?: boolean;
  };
  review: {
    status: ReviewStatus;
    flags: ReviewFlag[];
  };
  grading:
    | {
        mode: "deterministic";
        answerFormat: "choice" | "number" | "text" | "expression" | "equation";
      }
    | {
        mode: "step_based";
        answerFormat: "final_with_optional_working";
        scoreStrategy: "final_only" | "final_plus_steps";
      }
    | {
        mode: "ai_rubric";
        answerFormat: "open_text";
        rubricVersion: string;
        requireExplanation?: boolean;
      };
}

export interface OpenResponseAiQuestion extends QuestionBase {
  kind: "open_response_ai";
  rubric: {
    modelAnswer: string;
    scoringCriteria: Array<{
      key: string;
      description: string;
      points: number;
    }>;
    maxPoints: number;
  };
}

export type Question = QuestionBase | OpenResponseAiQuestion;

export interface IngestionQuestion {
  id: string;
  jobId: string;
  draftId: string;
  nodeId: string | null;
  questionOrder: number;
  normalizedQuestion: Question | null;
  rawExtractedBlock: ExtractedQuestionBlock;
  confidence: number | null;
  reviewStatus: ReviewStatus;
  flags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IngestionChatMessage {
  id: string;
  jobId: string;
  role: "user" | "assistant" | "system";
  message: string;
  patchSummary: DraftPatch[] | null;
  createdAt: string;
}

export interface IngestionAsset {
  id: string;
  jobId: string;
  assetType: "original_pdf" | "page_image" | "region_crop" | "diagram";
  path: string;
  page: number | null;
  regionId: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface DraftPatch {
  op:
    | "update_node_title"
    | "move_question"
    | "replace_question"
    | "split_question"
    | "delete_question"
    | "flag_question"
    | "set_review_status";
  nodeId?: string;
  title?: string;
  questionId?: string;
  targetNodeId?: string;
  question?: Question;
  parts?: Question[];
  flags?: string[];
  reviewStatus?: ReviewStatus;
}

export interface CreateIngestionJobInput {
  adminUserId: string;
  classId?: string | null;
  visibility: ProgramVisibility;
  sourceFileName: string;
  sourceFilePath?: string;
  title?: string;
  gradeBand?: string | null;
  adminNote?: string;
}

export interface IngestionJobState {
  job: IngestionJob;
  draft: IngestionDraft;
  questions: IngestionQuestion[];
  messages: IngestionChatMessage[];
  assets: IngestionAsset[];
}

export interface CreateIngestionJobResult {
  jobId: string;
  draftId: string;
  status: IngestionJobStatus;
}

export interface IngestionJobSummary {
  jobId: string;
  draftId: string;
  status: IngestionJobStatus;
  stage: string | null;
  visibility: ProgramVisibility;
  sourceFileName: string;
  title: string;
  updatedAt: string;
}

export interface AttachIngestionSourceFileInput {
  fileName: string;
  mimeType?: string;
  contentBase64: string;
}

export interface AttachIngestionSourceFileResult {
  assetId: string;
  path: string;
  mimeType: string | null;
}

export interface RunIngestionStageInput {
  stage: "extractDocument" | "auditExtraction" | "segmentQuestions" | "normalizeQuestions" | "structureDraft";
}
