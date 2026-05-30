import type { ExtractedDocument } from "./extractionTypes";
import type { ExtractedQuestionBlock } from "./types";

function makeBlockId(page: number, index: number): string {
  return `qblk_p${page}_${index + 1}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function splitChunkIntoSubparts(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const partPattern = /(?:^|\n)\s*([a-zA-Z]\))/g;
  const matches = Array.from(normalized.matchAll(partPattern));
  if (matches.length < 2) return [normalized];

  const introStart = matches[0]?.index ?? 0;
  const stem = normalized.slice(0, introStart).trim();
  const parts: string[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const nextStart = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
    const partText = normalized.slice(start, nextStart).trim();
    if (!partText) continue;
    parts.push(stem ? `${stem}\n${partText}` : partText);
  }

  return parts.length > 0 ? parts : [normalized];
}

function splitPageIntoQuestionChunks(text: string): Array<{ label?: string; rawText: string }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const pattern = /(?:^|\n)\s*((?:Q\s*)?\d+[.)-]|\([a-zA-Z]\))/g;
  const matches = Array.from(normalized.matchAll(pattern));

  if (matches.length === 0) {
    return [{ rawText: normalized }];
  }

  const chunks: Array<{ label?: string; rawText: string }> = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const nextStart = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
    const rawText = normalized.slice(start, nextStart).trim();
    const label = match[1]?.trim();
    if (rawText) {
      chunks.push({ label, rawText });
    }
  }

  return chunks.length > 0 ? chunks : [{ rawText: normalized }];
}

export function segmentQuestionsFromExtractedDocument(document: ExtractedDocument): ExtractedQuestionBlock[] {
  const blocks: ExtractedQuestionBlock[] = [];

  for (const page of document.pages) {
    const chunks = splitPageIntoQuestionChunks(page.fullText);
    chunks.forEach((chunk, index) => {
      const subparts = splitChunkIntoSubparts(chunk.rawText);
      subparts.forEach((subpartText, subpartIndex) => {
        blocks.push({
          id: makeBlockId(page.page, index * 10 + subpartIndex),
          page: page.page,
          questionLabel: subparts.length > 1 ? `${chunk.label ?? `${index + 1}`}${String.fromCharCode(97 + subpartIndex)}` : chunk.label,
          rawText: subpartText,
          regionIds: page.regions.map((region) => region.id),
          imagePaths: page.imagePaths,
          splitConfidence: subparts.length > 1 ? 0.9 : (chunks.length === 1 && !chunk.label ? 0.45 : 0.8),
          scanConfidence: page.regions[0]?.confidence,
          notes: subparts.length > 1
            ? ["Split a multipart question block into labeled subparts."]
            : (chunks.length === 1 && !chunk.label ? ["No explicit question numbering detected; treated page text as a single question block."] : []),
        });
      });
    });
  }

  return blocks;
}
