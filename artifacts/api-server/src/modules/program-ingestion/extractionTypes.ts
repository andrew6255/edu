import type { ExtractionQuality } from "./types";

export interface ExtractedTextRegion {
  id: string;
  page: number;
  text: string;
  bbox?: { x: number; y: number; width: number; height: number };
  kind?: "text" | "table" | "image_caption" | "header" | "footer";
  confidence?: number;
}

export interface ExtractedDocumentPage {
  page: number;
  fullText: string;
  regions: ExtractedTextRegion[];
  imagePaths?: string[];
  quality?: ExtractionQuality;
}

export interface ExtractedDocument {
  fileName: string;
  pageCount: number;
  pages: ExtractedDocumentPage[];
  extractionProvider: string;
  createdAt: string;
}
