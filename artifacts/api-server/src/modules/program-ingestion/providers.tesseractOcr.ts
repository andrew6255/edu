import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import type { ExtractedDocument, ExtractedDocumentPage } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";

const execAsync = util.promisify(exec);

export class TesseractOcrExtractionProvider implements DocumentExtractionProvider {
  readonly name = "tesseract_ocr";

  async extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);
    console.log(`[tesseract] Starting OCR for ${fileName}...`);
    
    try {
      // Create a temporary file for the output (tesseract automatically adds .txt)
      const outDir = path.dirname(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const outPrefix = path.join(outDir, `${baseName}_ocr`);
      
      // Run tesseract
      // Note: Assumes tesseract is installed and available in PATH
      const { stdout, stderr } = await execAsync(`tesseract "${filePath}" "${outPrefix}" -l eng`);
      
      const outFilePath = `${outPrefix}.txt`;
      const fullText = await fs.readFile(outFilePath, "utf8");
      
      // Cleanup temp output
      try {
        await fs.unlink(outFilePath);
      } catch (cleanupErr) {
        console.warn(`[tesseract] Failed to cleanup ${outFilePath}:`, cleanupErr);
      }
      
      const text = fullText.trim();
      
      if (!text) {
        console.warn(`[tesseract] OCR produced empty text for ${fileName}`);
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
      console.error(`[tesseract] OCR failed for ${fileName}:`, err);
      throw err;
    }
  }
}
