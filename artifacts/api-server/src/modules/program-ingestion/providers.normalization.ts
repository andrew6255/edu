import type { AiQuestionAnalysis, ExtractedQuestionBlock } from "./types";
import { buildQuestionNormalizationPrompt } from "./normalization.prompts";
import { normalizeQuestionBlock as fallbackNormalizeQuestionBlock } from "./normalization";

export interface QuestionNormalizationProvider {
  name: string;
  normalize(block: ExtractedQuestionBlock): Promise<AiQuestionAnalysis>;
}

export class DeterministicFallbackNormalizationProvider implements QuestionNormalizationProvider {
  readonly name = "deterministic_fallback_normalizer";

  async normalize(block: ExtractedQuestionBlock): Promise<AiQuestionAnalysis> {
    return fallbackNormalizeQuestionBlock(block);
  }
}

function isAiQuestionAnalysis(value: unknown): value is AiQuestionAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["detectedKind"] === "string"
    && typeof candidate["confidence"] === "number"
    && typeof candidate["isMultiPart"] === "boolean"
    && typeof candidate["needsDiagram"] === "boolean"
    && typeof candidate["autoGradable"] === "boolean"
    && typeof candidate["recommendedGradingMode"] === "string"
    && Array.isArray(candidate["warnings"])
    && candidate["normalizedQuestion"] !== undefined;
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate);
}

abstract class BasePromptReadyLlmNormalizationProvider implements QuestionNormalizationProvider {
  abstract readonly name: string;

  protected abstract providerLabel(): string;

  async normalize(block: ExtractedQuestionBlock): Promise<AiQuestionAnalysis> {
    const prompt = buildQuestionNormalizationPrompt(block);
    throw new Error(
      `${this.providerLabel()} normalization adapter is not implemented yet. Prompt scaffolding is ready. Configure this provider or use PROGRAM_INGESTION_NORMALIZATION_PROVIDER=fallback. Prompt sizes: system=${prompt.system.length}, user=${prompt.user.length}.`,
    );
  }
}

export class OpenAiNormalizationProvider extends BasePromptReadyLlmNormalizationProvider {
  readonly name = "openai_normalizer";

  protected providerLabel(): string {
    return "OpenAI";
  }
}

export class AnthropicNormalizationProvider extends BasePromptReadyLlmNormalizationProvider {
  readonly name = "anthropic_normalizer";

  protected providerLabel(): string {
    return "Anthropic";
  }
}

export class GeminiNormalizationProvider extends BasePromptReadyLlmNormalizationProvider {
  readonly name = "gemini_normalizer";

  protected providerLabel(): string {
    return "Gemini";
  }

  override async normalize(block: ExtractedQuestionBlock): Promise<AiQuestionAnalysis> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required when PROGRAM_INGESTION_NORMALIZATION_PROVIDER=gemini.");
    }

    const model = process.env["PROGRAM_INGESTION_GEMINI_MODEL"] ?? "gemini-2.0-flash";
    const prompt = buildQuestionNormalizationPrompt(block);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: `${prompt.system}\n\n${prompt.user}` },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`Gemini rate-limited (429). Falling back to deterministic normalizer for block ${block.id}.`);
        return new DeterministicFallbackNormalizationProvider().normalize(block);
      }
      const errorText = await response.text();
      throw new Error(`Gemini normalization request failed with status ${response.status}: ${errorText}`);
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
      throw new Error("Gemini normalization response did not include any text content.");
    }

    const parsed = parseJsonResponse(text);
    if (!isAiQuestionAnalysis(parsed)) {
      throw new Error("Gemini normalization response did not match the expected AiQuestionAnalysis shape.");
    }

    return parsed;
  }
}

export function getQuestionNormalizationProvider(): QuestionNormalizationProvider {
  const provider = (process.env["PROGRAM_INGESTION_NORMALIZATION_PROVIDER"] ?? "fallback").toLowerCase().trim();

  switch (provider) {
    case "":
    case "fallback":
      return new DeterministicFallbackNormalizationProvider();
    case "openai":
      return new OpenAiNormalizationProvider();
    case "anthropic":
      return new AnthropicNormalizationProvider();
    case "gemini":
      return new GeminiNormalizationProvider();
    default:
      throw new Error(
        `Unsupported PROGRAM_INGESTION_NORMALIZATION_PROVIDER value: ${provider}. Supported values are fallback, openai, anthropic, gemini.`,
      );
  }
}
