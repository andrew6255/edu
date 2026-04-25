import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ExtractedDocument } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";

const execFileAsync = promisify(execFile);

export class PythonPyMuPdfExtractionProvider implements DocumentExtractionProvider {
  readonly name = "python_pymupdf_pdf";

  async extract(filePath: string, _sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const fileName = path.basename(filePath);

    const pythonScript = String.raw`
import json
import sys
import fitz

pdf_path = sys.argv[1]
doc = fitz.open(pdf_path)
pages = []
for i, page in enumerate(doc):
    text = page.get_text("text") or ""
    pages.append({
        "page": i + 1,
        "text": text.strip(),
    })
print(json.dumps({"pages": pages}, ensure_ascii=False))
`;

    const { stdout } = await execFileAsync("python", ["-c", pythonScript, filePath], {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    const parsed = JSON.parse(stdout) as { pages?: Array<{ page: number; text: string }> };
    const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];

    const usablePages = rawPages.filter((p) => typeof p.text === "string" && p.text.trim().length > 0);
    if (usablePages.length === 0) {
      throw new Error(`PyMuPDF could not extract readable text from ${fileName}.`);
    }

    return {
      fileName,
      pageCount: rawPages.length || 1,
      extractionProvider: this.name,
      createdAt: new Date().toISOString(),
      pages: rawPages.map((p, idx) => ({
        page: typeof p.page === "number" ? p.page : idx + 1,
        fullText: typeof p.text === "string" ? p.text.trim() : "",
        quality: (typeof p.text === "string" && p.text.trim().length > 20 ? "high" : "low") as "high" | "low",
        regions: [
          {
            id: `page${typeof p.page === "number" ? p.page : idx + 1}_region1`,
            page: typeof p.page === "number" ? p.page : idx + 1,
            text: typeof p.text === "string" ? p.text.trim() : "",
            kind: "text",
            confidence: 0.95,
          },
        ],
      })),
    };
  }
}
