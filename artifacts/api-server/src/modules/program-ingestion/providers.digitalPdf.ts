import { readFile } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import type { ExtractedDocument } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";
import { GeminiVisionPdfExtractionProvider } from "./providers.geminiVisionPdf";
import { PythonPyMuPdfExtractionProvider } from "./providers.pythonPdf";

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function renderPdfPageText(pageData: { getTextContent: (options?: Record<string, unknown>) => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }): Promise<string> {
  const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const parts: string[] = [];
  for (const item of textContent.items) {
    const str = typeof item.str === "string" ? item.str : "";
    if (str) parts.push(str);
    if (item.hasEOL) parts.push("\n");
    else parts.push(" ");
  }
  return normalizeExtractedText(parts.join(""));
}

export class PdfParseDigitalDocumentExtractionProvider implements DocumentExtractionProvider {
  readonly name = "pdf_parse_digital_document";

  async extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);
    const buffer = await readFile(filePath);
    const parsed = await pdfParse(buffer, { pagerender: renderPdfPageText });
    const fullText = normalizeExtractedText(parsed.text ?? "");
    const pageCount = typeof parsed.numpages === "number" && parsed.numpages > 0 ? parsed.numpages : 1;

    // pdf-parse returns all text concatenated; split heuristically by form-feed or treat as one page
    const rawPages = fullText.length > 0
      ? fullText.split(/\f/).map((t) => t.trim()).filter(Boolean)
      : [];

    // If pdf-parse found real text, use it
    if (rawPages.length > 0 && rawPages.some((page) => page.trim().length > 20)) {
      const pages = rawPages.map((text, idx) => ({
        page: idx + 1,
        fullText: text,
        quality: "high" as const,
        regions: [
          {
            id: `page${idx + 1}_region1`,
            page: idx + 1,
            text,
            kind: "text" as const,
            confidence: 0.92,
          },
        ],
      }));

      return {
        fileName,
        pageCount,
        extractionProvider: this.name,
        createdAt: new Date().toISOString(),
        pages,
      };
    }

    // No text found — try a stronger text extractor via Python/PyMuPDF first.
    try {
      console.log(`[pdf-extraction] No usable text from pdf-parse for ${fileName}. Falling back to Python/PyMuPDF...`);
      const pythonResult = await new PythonPyMuPdfExtractionProvider().extract(filePath, sourceAsset);
      console.log(`[pdf-extraction] Python/PyMuPDF succeeded for ${fileName}. pageCount=${pythonResult.pageCount}`);
      return pythonResult;
    } catch (err) {
      console.warn(`[pdf-extraction] Python/PyMuPDF extraction failed for ${fileName}:`, err);
    }

    // Still no text — PDF is likely scanned/image-based. Try Gemini Vision OCR.
    const hasGeminiKey = !!process.env["GEMINI_API_KEY"];
    if (hasGeminiKey) {
      console.log(`[pdf-extraction] No text from pdf-parse for ${fileName}. Falling back to Gemini Vision OCR...`);
      try {
        const geminiResult = await new GeminiVisionPdfExtractionProvider().extract(filePath, sourceAsset);
        console.log(`[pdf-extraction] Gemini Vision OCR succeeded for ${fileName}. pageCount=${geminiResult.pageCount}`);
        return geminiResult;
      } catch (err) {
        console.warn(`[pdf-extraction] Gemini Vision OCR failed for ${fileName}:`, err);
        // Fall through to placeholder below
      }
    }

    // Last resort: placeholder
    return {
      fileName,
      pageCount,
      extractionProvider: this.name,
      createdAt: new Date().toISOString(),
      pages: [
        {
          page: 1,
          fullText: `[No extractable text found in ${fileName}. The PDF may be scanned or image-based.]`,
          quality: "low" as const,
          regions: [
            {
              id: "page1_region1",
              page: 1,
              text: `[No extractable text found in ${fileName}.]`,
              kind: "text" as const,
              confidence: 0.1,
            },
          ],
        },
      ],
    };
  }
}
