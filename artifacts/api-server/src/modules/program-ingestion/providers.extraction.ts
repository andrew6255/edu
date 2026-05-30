import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractedDocument } from "./extractionTypes";
import { PdfParseDigitalDocumentExtractionProvider } from "./providers.digitalPdf";
import { getConfiguredScanDocumentExtractionProvider } from "./providers.scanOcr";
import type { ExtractionQuality, IngestionAsset } from "./types";

export interface DocumentExtractionProvider {
  name: string;
  extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument>;
}

function inferQuality(fileName: string): ExtractionQuality {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".json")) return "high";
  if (lower.endsWith(".pdf")) return "medium";
  return "low";
}

export class StubDigitalDocumentExtractionProvider implements DocumentExtractionProvider {
  readonly name = "stub_digital_document";

  async extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    let fullText = "";

    if (ext === ".txt" || ext === ".md" || ext === ".json") {
      fullText = await readFile(filePath, "utf8");
    } else {
      fullText = [
        `Source file: ${fileName}`,
        "Digital-document stub provider used.",
        "Direct PDF text extraction is not connected yet.",
        "Next step: route PDFs to a real digital PDF extraction provider.",
      ].join("\n");
    }

    return {
      fileName,
      pageCount: 1,
      extractionProvider: this.name,
      createdAt: new Date().toISOString(),
      pages: [
        {
          page: 1,
          fullText,
          quality: inferQuality(fileName),
          regions: [
            {
              id: "page1_region1",
              page: 1,
              text: fullText,
              kind: "text",
              confidence: ext === ".pdf" ? 0.45 : 0.95,
            },
          ],
        },
      ],
    };
  }
}

export function chooseDocumentExtractionProvider(sourceAsset: IngestionAsset): DocumentExtractionProvider {
  const lowerPath = sourceAsset.path.toLowerCase();
  const mime = (sourceAsset.mimeType ?? "").toLowerCase();

  const looksLikeText = lowerPath.endsWith(".txt") || lowerPath.endsWith(".md") || lowerPath.endsWith(".json");
  if (looksLikeText) {
    return new StubDigitalDocumentExtractionProvider();
  }

  const looksLikeImage = mime.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(lowerPath);
  if (looksLikeImage) {
    return getConfiguredScanDocumentExtractionProvider();
  }

  const looksLikePdf = mime === "application/pdf" || lowerPath.endsWith(".pdf");
  if (looksLikePdf) {
    return new PdfParseDigitalDocumentExtractionProvider();
  }

  return getConfiguredScanDocumentExtractionProvider();
}

export function getDefaultDocumentExtractionProvider(sourceAsset: IngestionAsset): DocumentExtractionProvider {
  return chooseDocumentExtractionProvider(sourceAsset);
}
