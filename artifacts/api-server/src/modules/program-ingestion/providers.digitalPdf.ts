import { readFile } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import type { ExtractedDocument } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";

export class PdfParseDigitalDocumentExtractionProvider implements DocumentExtractionProvider {
  readonly name = "pdf_parse_digital_document";

  async extract(filePath: string, _sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);
    const buffer = await readFile(filePath);
    const parsed = await pdfParse(buffer);
    const fullText = (parsed.text ?? "").trim();

    return {
      fileName,
      pageCount: typeof parsed.numpages === "number" && parsed.numpages > 0 ? parsed.numpages : 1,
      extractionProvider: this.name,
      createdAt: new Date().toISOString(),
      pages: [
        {
          page: 1,
          fullText,
          quality: fullText.length > 0 ? "high" : "low",
          regions: [
            {
              id: "page1_region1",
              page: 1,
              text: fullText,
              kind: "text",
              confidence: fullText.length > 0 ? 0.92 : 0.2,
            },
          ],
        },
      ],
    };
  }
}
