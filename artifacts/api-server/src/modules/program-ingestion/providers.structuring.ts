import type { IngestionJobState, ProgramNode, StructuredDraftSuggestion } from "./types";

function cleanTitleCandidate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/\.[^.]+$/, "")
    .replace(/^[a-z0-9]{6,}(?:[-_\s]+|$)/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFirstMeaningfulLine(state: IngestionJobState): string {
  const pages = state.draft.extractedDocument?.pages ?? [];
  for (const page of pages) {
    const lines = String(page.fullText ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.length < 4) continue;
      if (/^(name|date|class|worksheet)\b/i.test(line)) continue;
      return line;
    }
  }
  return "";
}

function summarizeTopicFromQuestions(state: IngestionJobState): string {
  const joined = state.questions.map((q) => q.rawExtractedBlock.rawText).join("\n").toLowerCase();
  if (/equation of the line|line passes through|points .* line|y\s*=/.test(joined)) return "Lines and Linear Equations";
  if (/graph|coordinate/.test(joined)) return "Graphs and Coordinates";
  if (/fraction/.test(joined)) return "Fractions";
  if (/algebra/.test(joined)) return "Algebra Practice";
  return "Worksheet Practice";
}

function chooseLineQuestionTypeTitle(text: string): string {
  const lower = text.toLowerCase();
  if (/find the equation of the line|passing through the points/.test(lower) && !/find\s+3\s+other\s+points/.test(lower)) {
    return "Find Equation from Two Points";
  }
  if (/list\s+10\s+points|generate\s+10\s+points/.test(lower)) {
    return "Generate Points from Equation";
  }
  if (/find\s+3\s+other\s+points/.test(lower)) {
    return "Find Equation and Other Points";
  }
  return "Line Questions";
}

function chooseProgramTitle(state: IngestionJobState): string {
  const candidates = [
    cleanTitleCandidate(state.draft.extractionReport?.titleGuess),
    cleanTitleCandidate(state.draft.title),
    cleanTitleCandidate(getFirstMeaningfulLine(state)),
    cleanTitleCandidate(state.job.sourceFileName),
  ].filter(Boolean);

  const first = candidates[0] ?? "";
  if (first && !/^worksheet$/i.test(first) && !/^[a-z0-9]{6,}$/i.test(first)) return first;

  const topic = summarizeTopicFromQuestions(state);
  return topic === "Worksheet Practice" ? "Imported Worksheet" : `${topic} Worksheet`;
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate);
}

function isStructuredDraftSuggestion(value: unknown): value is StructuredDraftSuggestion {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["title"] === "string"
    && Array.isArray(v["divisions"])
    && Array.isArray(v["chapters"]);
}

export interface DraftStructuringProvider {
  name: string;
  structure(state: IngestionJobState): Promise<StructuredDraftSuggestion>;
}

export class DeterministicFallbackDraftStructuringProvider implements DraftStructuringProvider {
  readonly name = "deterministic_fallback_structurer";

  async structure(state: IngestionJobState): Promise<StructuredDraftSuggestion> {
    const title = chooseProgramTitle(state);
    const topicTitle = summarizeTopicFromQuestions(state);
    const groupedTopics = new Map<string, string[]>();

    for (const question of state.questions) {
      const questionTypeTitle = topicTitle === "Lines and Linear Equations"
        ? chooseLineQuestionTypeTitle(question.rawExtractedBlock.rawText)
        : "Practice Questions";
      groupedTopics.set(questionTypeTitle, [...(groupedTopics.get(questionTypeTitle) ?? []), question.id]);
    }

    const topics = Array.from(groupedTopics.entries()).map(([questionTypeTitle, questionIds]) => ({
      title: topicTitle,
      questionTypeTitle,
      questionIds,
    }));

    return {
      title,
      divisions: ["Chapters", "Topics"],
      chapters: [
        {
          title,
          topics,
        },
      ],
      summary: `Structured ${state.questions.length} question(s) into ${topics.length} question type group(s) under '${topicTitle}'.`,
    };
  }
}

export class GeminiDraftStructuringProvider implements DraftStructuringProvider {
  readonly name = "gemini_draft_structurer";

  async structure(state: IngestionJobState): Promise<StructuredDraftSuggestion> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required when PROGRAM_INGESTION_STRUCTURING_PROVIDER=gemini.");
    }

    const model = process.env["PROGRAM_INGESTION_GEMINI_MODEL"] ?? "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const extractedText = (state.draft.extractedDocument?.pages ?? [])
      .map((page) => `--- PAGE ${page.page} ---\n${page.fullText}`)
      .join("\n\n")
      .slice(0, 50000);

    const questionSummaries = state.questions.map((q, idx) => ({
      id: q.id,
      order: idx + 1,
      rawText: q.rawExtractedBlock.rawText,
      detectedKind: q.normalizedQuestion?.kind ?? null,
    }));

    const prompt = `You are structuring an educational program imported from a worksheet or PDF.
Return STRICT JSON with this shape:
{
  "title": "Clean human-readable program title",
  "divisions": ["Chapters", "Topics"],
  "chapters": [
    {
      "title": "Chapter title",
      "topics": [
        {
          "title": "Topic title",
          "questionTypeTitle": "Questions or MCQ or Practice",
          "questionIds": ["existing-question-id"]
        }
      ]
    }
  ],
  "summary": "brief summary"
}

Rules:
- Use only questionIds from the provided list.
- Do not invent questionIds.
- Clean ugly filenames/prefixes from the title.
- Choose a small, sensible hierarchy for a worksheet. Usually one chapter with one or more topics.
- Use divisions exactly as an array of labels ending before question types.
- If content is limited, still produce a valid structure.
- Return only JSON.

SOURCE FILE: ${state.job.sourceFileName}
TITLE GUESS: ${state.draft.extractionReport?.titleGuess ?? ""}
QUESTION IDS: ${JSON.stringify(questionSummaries.map((q) => q.id))}
QUESTION SUMMARIES: ${JSON.stringify(questionSummaries)}
EXTRACTED TEXT:\n${extractedText}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn("Gemini structuring rate-limited (429). Falling back to deterministic structurer.");
        return new DeterministicFallbackDraftStructuringProvider().structure(state);
      }
      const errorText = await response.text();
      throw new Error(`Gemini structuring request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    if (!text) {
      throw new Error("Gemini structuring response did not include any text content.");
    }

    const parsed = parseJsonResponse(text);
    if (!isStructuredDraftSuggestion(parsed)) {
      throw new Error("Gemini structuring response did not match the expected StructuredDraftSuggestion shape.");
    }

    return parsed;
  }
}

export function getDraftStructuringProvider(): DraftStructuringProvider {
  const provider = (process.env["PROGRAM_INGESTION_STRUCTURING_PROVIDER"] ?? "gemini").toLowerCase().trim();

  switch (provider) {
    case "":
    case "fallback":
      return new DeterministicFallbackDraftStructuringProvider();
    case "gemini":
      return new GeminiDraftStructuringProvider();
    default:
      throw new Error(
        `Unsupported PROGRAM_INGESTION_STRUCTURING_PROVIDER value: ${provider}. Supported values are fallback, gemini.`,
      );
  }
}

export function structuredSuggestionToProgramNodes(suggestion: StructuredDraftSuggestion): ProgramNode[] {
  return suggestion.chapters.map((chapter, chapterIndex) => ({
    id: `chapter_${chapterIndex + 1}`,
    type: "chapter",
    title: chapter.title,
    children: chapter.topics.map((topic, topicIndex) => ({
      id: `chapter_${chapterIndex + 1}_topic_${topicIndex + 1}`,
      type: "topic",
      title: topic.title,
      questionRefs: topic.questionIds,
      questionTypeTitle: topic.questionTypeTitle,
      children: [],
    })),
  }));
}
