export function getProgramIngestionOcrProviderName(): string {
  return (process.env["PROGRAM_INGESTION_OCR_PROVIDER"] ?? "tesseract").toLowerCase().trim() || "tesseract";
}
