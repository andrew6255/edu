import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtractedDocument, ExtractedTextRegion } from './extractionTypes';
import type { IngestionAsset } from './types';
import type { DocumentExtractionProvider } from './providers.extraction';

type MistralBlock = Record<string, unknown>;
type MistralPage = {
  index?: number;
  markdown?: string;
  blocks?: MistralBlock[] | null;
  confidence_scores?: {
    average_page_confidence_score?: number;
    minimum_page_confidence_score?: number;
  } | null;
};

function mimeType(filePath: string, sourceAsset: IngestionAsset): string {
  if (sourceAsset.mimeType) return sourceAsset.mimeType;
  const extension = path.extname(filePath).toLowerCase();
  const known: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return known[extension] ?? 'application/octet-stream';
}

function blockText(block: MistralBlock): string {
  for (const key of ['content', 'text', 'markdown']) {
    const value = block[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function blockKind(block: MistralBlock): ExtractedTextRegion['kind'] {
  const label = String(block['type'] ?? block['label'] ?? '').toLowerCase();
  if (label === 'table') return 'table';
  if (label === 'header') return 'header';
  if (label === 'footer') return 'footer';
  if (label === 'image' || label === 'caption') return 'image_caption';
  return 'text';
}

function blockBbox(block: MistralBlock): ExtractedTextRegion['bbox'] | undefined {
  const raw = block['bbox'] ?? block['bounding_box'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const box = raw as Record<string, unknown>;
  const x = Number(box['x'] ?? box['x1'] ?? box['left']);
  const y = Number(box['y'] ?? box['y1'] ?? box['top']);
  const width = Number(box['width'] ?? (Number(box['x2']) - x));
  const height = Number(box['height'] ?? (Number(box['y2']) - y));
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : undefined;
}

function pageConfidence(page: MistralPage): number | undefined {
  const value = page.confidence_scores?.average_page_confidence_score;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class MistralOcrExtractionProvider implements DocumentExtractionProvider {
  readonly name = 'mistral_ocr';

  async extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const apiKey = (process.env['MISTRAL_API_KEY'] ?? '').trim();
    if (!apiKey) throw new Error('MISTRAL_API_KEY is required when PROGRAM_INGESTION_OCR_PROVIDER=mistral.');

    const fileName = path.basename(filePath);
    const mime = mimeType(filePath, sourceAsset);
    const encoded = (await readFile(filePath)).toString('base64');
    const dataUrl = `data:${mime};base64,${encoded}`;
    const image = mime.startsWith('image/');
    const model = (process.env['PROGRAM_INGESTION_MISTRAL_OCR_MODEL'] ?? 'mistral-ocr-latest').trim();

    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        document: image
          ? { type: 'image_url', image_url: dataUrl }
          : { type: 'document_url', document_url: dataUrl },
        include_image_base64: false,
        include_blocks: true,
        table_format: 'markdown',
        confidence_scores_granularity: 'page',
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Mistral OCR failed (${response.status}): ${detail}`);
    }

    const payload = await response.json() as { pages?: MistralPage[]; model?: string };
    const sourcePages = Array.isArray(payload.pages) ? payload.pages : [];
    if (sourcePages.length === 0) throw new Error('Mistral OCR returned no document pages.');

    const pages = sourcePages.map((page, pageIndex) => {
      const pageNumber = typeof page.index === 'number' ? page.index + 1 : pageIndex + 1;
      const fullText = typeof page.markdown === 'string' ? page.markdown.trim() : '';
      const confidence = pageConfidence(page);
      const regions: ExtractedTextRegion[] = Array.isArray(page.blocks)
        ? page.blocks.map((block, blockIndex) => ({
            id: `page${pageNumber}_region${blockIndex + 1}`,
            page: pageNumber,
            text: blockText(block),
            kind: blockKind(block),
            bbox: blockBbox(block),
            confidence,
          })).filter(region => region.text)
        : [];
      if (regions.length === 0) {
        regions.push({
          id: `page${pageNumber}_region1`,
          page: pageNumber,
          text: fullText,
          kind: 'text',
          confidence,
        });
      }
      return {
        page: pageNumber,
        fullText,
        regions,
        quality: confidence === undefined ? (fullText ? 'medium' as const : 'low' as const)
          : confidence >= 0.9 ? 'high' as const
            : confidence >= 0.7 ? 'medium' as const : 'low' as const,
      };
    });

    return {
      fileName,
      pageCount: pages.length,
      pages,
      extractionProvider: `${this.name}:${payload.model ?? model}`,
      createdAt: new Date().toISOString(),
    };
  }
}
