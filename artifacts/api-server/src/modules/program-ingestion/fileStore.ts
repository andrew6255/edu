import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredIngestionFile {
  path: string;
  sizeBytes: number;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function storeProgramIngestionSourceFile(
  jobId: string,
  fileName: string,
  contentBase64: string,
): Promise<StoredIngestionFile> {
  const safeName = sanitizeFileName(fileName || "upload.bin");
  const rootDir = process.env["PROGRAM_INGESTION_STORAGE_DIR"]
    ? path.resolve(process.env["PROGRAM_INGESTION_STORAGE_DIR"])
    : path.resolve(process.cwd(), ".data", "program-ingestion");
  const jobDir = path.join(rootDir, jobId);
  await mkdir(jobDir, { recursive: true });

  const cleanedBase64 = contentBase64.replace(/^data:[^;]+;base64,/, "").trim();
  const buffer = Buffer.from(cleanedBase64, "base64");
  const fullPath = path.join(jobDir, `${Date.now().toString(36)}-${safeName}`);
  await writeFile(fullPath, buffer);

  return {
    path: fullPath,
    sizeBytes: buffer.byteLength,
  };
}
