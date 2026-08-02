import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MistralOcrExtractionProvider } from './providers.mistralOcr';
import type { IngestionAsset } from './types';

const previousKey = process.env['MISTRAL_API_KEY'];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete process.env['MISTRAL_API_KEY'];
  else process.env['MISTRAL_API_KEY'] = previousKey;
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ filePath: string; asset: IngestionAsset }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mistral-ocr-test-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'worksheet.pdf');
  await writeFile(filePath, Buffer.from('%PDF-test'));
  return {
    filePath,
    asset: {
      id: 'asset-1',
      jobId: 'job-1',
      assetType: 'original_pdf',
      path: filePath,
      page: null,
      regionId: null,
      mimeType: 'application/pdf',
      createdAt: new Date().toISOString(),
    },
  };
}

describe('MistralOcrExtractionProvider', () => {
  it('requires a server-side Mistral credential', async () => {
    delete process.env['MISTRAL_API_KEY'];
    const { filePath, asset } = await fixture();
    await expect(new MistralOcrExtractionProvider().extract(filePath, asset)).rejects.toThrow('MISTRAL_API_KEY');
  });

  it('maps OCR pages, blocks, confidence, and bounding boxes', async () => {
    process.env['MISTRAL_API_KEY'] = 'test-server-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'mistral-ocr-4-0',
      pages: [{
        index: 0,
        markdown: '## Exercise\nSolve $2x+3=11$.',
        confidence_scores: { average_page_confidence_score: 0.96 },
        blocks: [{ type: 'equation', content: '$2x+3=11$', bbox: { x1: 10, y1: 20, x2: 210, y2: 70 } }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { filePath, asset } = await fixture();

    const result = await new MistralOcrExtractionProvider().extract(filePath, asset);

    expect(result.extractionProvider).toBe('mistral_ocr:mistral-ocr-4-0');
    expect(result.pages[0]).toMatchObject({ page: 1, quality: 'high' });
    expect(result.pages[0].regions[0]).toMatchObject({
      text: '$2x+3=11$',
      bbox: { x: 10, y: 20, width: 200, height: 50 },
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.document.type).toBe('document_url');
    expect(request.document.document_url).toMatch(/^data:application\/pdf;base64,/);
  });
});
