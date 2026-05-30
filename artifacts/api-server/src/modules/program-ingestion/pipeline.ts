import type { AiExtractionAudit, IngestionJobState } from "./types";
import { getDefaultDocumentExtractionProvider } from "./providers.extraction";
import type { ExtractedDocument } from "./extractionTypes";

export async function extractDocumentForJob(state: IngestionJobState): Promise<ExtractedDocument> {
  const source = state.assets.find((asset) => asset.assetType === "original_pdf");
  if (!source) {
    throw new Error("No source file asset found for this ingestion job.");
  }

  const provider = getDefaultDocumentExtractionProvider(source);
  return provider.extract(source.path, source);
}

export function buildExtractionAudit(document: ExtractedDocument): AiExtractionAudit {
  const pages = document.pages.map((page) => ({
    page: page.page,
    quality: page.quality ?? "low",
    readable: (page.fullText || "").trim().length > 0,
    issues: page.quality === "low" ? ["Low-confidence extraction. Manual review recommended."] : [],
  }));

  const hasLow = pages.some((page) => page.quality === "low");
  const containsTables = document.pages.some((page) => page.regions.some((region) => region.kind === "table"));
  const isScanProvider = document.extractionProvider.includes("scan");

  return {
    titleGuess: (document as any).title || document.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(),
    subjectGuess: "mathematics",
    quality: hasLow ? "low" : pages.some((page) => page.quality === "medium") ? "medium" : "high",
    pages,
    warnings: hasLow
      ? [
          {
            code: isScanProvider ? "low_quality_scan" : "ocr_unreadable_region",
            severity: "warning",
            page: 1,
            message: isScanProvider
              ? "Scan-oriented stub provider could not perform OCR yet. Connect a real OCR provider next."
              : "Digital-document stub provider could not extract PDF text yet. Connect a real digital PDF extractor next.",
          },
        ]
      : [],
    containsDiagrams: false,
    containsTables,
    containsHandwriting: false,
    recommendedNextAction: hasLow ? "needs_admin_review" : "continue",
  };
}
