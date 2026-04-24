import type {
  AttachIngestionSourceFileInput,
  CreateIngestionJobInput,
  ProgramVisibility,
  RunIngestionStageInput,
} from "./types";

function isVisibility(value: unknown): value is ProgramVisibility {
  return value === "public" || value === "private";
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

export function parseCreateIngestionJobInput(body: unknown): CreateIngestionJobInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const input = body as Record<string, unknown>;
  const visibility = input["visibility"];

  if (!isVisibility(visibility)) {
    throw new Error("visibility must be either 'public' or 'private'.");
  }

  const sourceFileName = asNonEmptyString(input["sourceFileName"], "sourceFileName");
  const adminUserId = asNonEmptyString(input["adminUserId"], "adminUserId");
  const sourceFilePath = typeof input["sourceFilePath"] === "string" && input["sourceFilePath"].trim().length > 0
    ? input["sourceFilePath"].trim()
    : `/program-ingestion/pending/${Date.now()}-${sourceFileName}`;

  return {
    adminUserId,
    classId: typeof input["classId"] === "string" && input["classId"].trim().length > 0 ? input["classId"].trim() : null,
    visibility,
    sourceFileName,
    sourceFilePath,
    title: typeof input["title"] === "string" && input["title"].trim().length > 0 ? input["title"].trim() : undefined,
    gradeBand: typeof input["gradeBand"] === "string" && input["gradeBand"].trim().length > 0 ? input["gradeBand"].trim() : null,
    adminNote: typeof input["adminNote"] === "string" && input["adminNote"].trim().length > 0 ? input["adminNote"].trim() : undefined,
  };
}

export function parseAttachIngestionSourceFileInput(body: unknown): AttachIngestionSourceFileInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const input = body as Record<string, unknown>;

  return {
    fileName: asNonEmptyString(input["fileName"], "fileName"),
    mimeType: typeof input["mimeType"] === "string" && input["mimeType"].trim().length > 0 ? input["mimeType"].trim() : undefined,
    contentBase64: asNonEmptyString(input["contentBase64"], "contentBase64"),
  };
}

export function parseRunIngestionStageInput(body: unknown): RunIngestionStageInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const input = body as Record<string, unknown>;
  const stage = input["stage"];

  if (stage !== "extractDocument" && stage !== "auditExtraction" && stage !== "segmentQuestions" && stage !== "normalizeQuestions") {
    throw new Error("stage must be one of 'extractDocument', 'auditExtraction', 'segmentQuestions', or 'normalizeQuestions'.");
  }

  return { stage: stage as RunIngestionStageInput["stage"] };
}
