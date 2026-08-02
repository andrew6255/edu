import { execFile } from "node:child_process";
import fs, { access } from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import type { ExtractedDocument, ExtractedDocumentPage } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";
import { logger } from "../../lib/logger";

const execFileAsync = util.promisify(execFile);

async function resolveTesseractBinary(): Promise<string> {
  const configured = (process.env["TESSERACT_BIN"] ?? "").trim();
  if (configured) return configured;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
      "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe",
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next well-known installation path.
      }
    }
  }
  return "tesseract";
}

export class TesseractOcrExtractionProvider implements DocumentExtractionProvider {
  readonly name = "tesseract_ocr";

  async extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);
    logger.info({ fileName }, "[tesseract] Starting OCR...");
    
    try {
      // Create a temporary file for the output (tesseract automatically adds .txt)
      const outDir = path.dirname(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const outPrefix = path.join(outDir, `${baseName}_ocr`);
      
      const binary = await resolveTesseractBinary();
      const language = (process.env["PROGRAM_INGESTION_TESSERACT_LANGUAGE"] ?? "eng").trim() || "eng";
      await execFileAsync(binary, [filePath, outPrefix, "-l", language], {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      
      const outFilePath = `${outPrefix}.txt`;
      const fullText = await fs.readFile(outFilePath, "utf8");
      
      // Cleanup temp output
      try {
        await fs.unlink(outFilePath);
      } catch (cleanupErr) {
        logger.warn({ outFilePath, err: cleanupErr }, "[tesseract] Failed to cleanup:");
      }
      
      const text = fullText.trim();
      
      if (!text) {
        logger.warn({ fileName }, "[tesseract] OCR produced empty text");
      }

      return {
        fileName,
        pageCount: 1, // Currently assuming single image
        extractionProvider: this.name,
        createdAt: new Date().toISOString(),
        pages: [
          {
            page: 1,
            fullText: text || "No text could be extracted from this image.",
            quality: text ? "medium" : "low",
            regions: [
              {
                id: "page1_region1",
                page: 1,
                text: text,
                kind: "text",
                confidence: 0.7, // Tesseract doesn't give overall confidence easily without hOCR
              },
            ],
          },
        ],
      };
    } catch (err) {
      logger.error({ fileName, err }, "[tesseract] OCR failed:");
      throw err;
    }
  }
}
