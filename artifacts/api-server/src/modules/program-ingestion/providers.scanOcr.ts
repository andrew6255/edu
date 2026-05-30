import path from "node:path";
import type { ExtractedDocument } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";

export class StubScanDocumentExtractionProvider implements DocumentExtractionProvider {
  readonly name = "stub_scan_document";

  async extract(filePath: string, sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);
    const mime = sourceAsset.mimeType ?? "unknown";
    const fullText = [
      `Source file: ${fileName}`,
      `Source mime type: ${mime}`,
      "Scan-oriented stub provider used.",
      "OCR for scanned PDFs/images is not connected yet.",
      "Next step: plug in Mistral OCR, Google Document AI, or similar.",
    ].join("\n");

    return {
      fileName,
      pageCount: 1,
      extractionProvider: this.name,
      createdAt: new Date().toISOString(),
      pages: [
        {
          page: 1,
          fullText,
          quality: "low",
          regions: [
            {
              id: "page1_region1",
              page: 1,
              text: fullText,
              kind: "text",
              confidence: 0.25,
            },
          ],
        },
      ],
    };
  }
}

export class UnconfiguredScanOcrProvider implements DocumentExtractionProvider {
  readonly name = "unconfigured_scan_ocr";

  async extract(_filePath: string, _sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    throw new Error(
      "A scan OCR provider was requested but no OCR vendor is configured. Set PROGRAM_INGESTION_OCR_PROVIDER to a supported value and provide its credentials.",
    );
  }
}

export function getConfiguredScanDocumentExtractionProvider(): DocumentExtractionProvider {
  const provider = (process.env["PROGRAM_INGESTION_OCR_PROVIDER"] ?? "stub").toLowerCase().trim();

  switch (provider) {
    case "":
    case "stub":
      return new StubScanDocumentExtractionProvider();
    case "mistral":
    case "google":
    case "azure":
      return new UnconfiguredScanOcrProvider();
    default:
      throw new Error(
        `Unsupported PROGRAM_INGESTION_OCR_PROVIDER value: ${provider}. Supported values are stub, mistral, google, azure.`,
      );
  }
}
