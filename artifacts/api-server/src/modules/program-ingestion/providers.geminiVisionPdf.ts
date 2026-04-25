import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtractedDocument, ExtractedDocumentPage } from "./extractionTypes";
import type { IngestionAsset } from "./types";
import type { DocumentExtractionProvider } from "./providers.extraction";

const execFileAsync = promisify(execFile);

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate);
}

async function renderPdfPagesToBase64Png(filePath: string): Promise<Array<{ page: number; pngBase64: string }>> {
  const pythonScript = String.raw`
import base64
import io
import json
import sys
import fitz

pdf_path = sys.argv[1]
doc = fitz.open(pdf_path)
pages = []
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    png_bytes = pix.tobytes("png")
    pages.append({
        "page": i + 1,
        "pngBase64": base64.b64encode(png_bytes).decode("ascii")
    })
print(json.dumps({"pages": pages}))
`;

  const { stdout } = await execFileAsync("python", ["-c", pythonScript, filePath], {
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });

  const parsed = JSON.parse(stdout) as { pages?: Array<{ page: number; pngBase64: string }> };
  return Array.isArray(parsed.pages) ? parsed.pages : [];
}

export class GeminiVisionPdfExtractionProvider implements DocumentExtractionProvider {
  readonly name = "gemini_vision_pdf";

  async extract(filePath: string, _sourceAsset: IngestionAsset): Promise<ExtractedDocument> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for Gemini Vision PDF extraction.");
    }

    const model = process.env["PROGRAM_INGESTION_GEMINI_MODEL"] ?? "gemini-2.0-flash";
    const fileName = path.basename(filePath);
    const renderedPages = await renderPdfPagesToBase64Png(filePath);
    if (renderedPages.length === 0) {
      throw new Error(`Could not render any pages from ${fileName} for Gemini OCR.`);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const pagesData: Array<{ page: number; text: string }> = [];
    let bestTitle = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

    for (const renderedPage of renderedPages) {
      const systemPrompt = `You are an OCR specialist reading a worksheet image.
Return STRICT JSON with this exact shape:
{
  "title": "best document title guess",
  "text": "all readable text from this page"
}

Rules:
- Extract all visible text exactly and completely.
- Preserve numbering and line breaks where possible.
- Convert math into readable plain text.
- If this is not the first page and no title is visible, repeat the best overall title guess.
- Return only JSON.`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: systemPrompt },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: renderedPage.pngBase64,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini Vision page OCR failed with status ${response.status}: ${errorText}`);
      }

      const payload = await response.json() as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!rawText) {
        pagesData.push({ page: renderedPage.page, text: "" });
        continue;
      }

      try {
        const parsed = parseJsonResponse(rawText) as { title?: string; text?: string };
        if (typeof parsed.title === "string" && parsed.title.trim()) {
          bestTitle = parsed.title.trim();
        }
        pagesData.push({ page: renderedPage.page, text: typeof parsed.text === "string" ? parsed.text.trim() : "" });
      } catch {
        pagesData.push({ page: renderedPage.page, text: rawText });
      }
    }

    const pages: ExtractedDocumentPage[] = pagesData.map((p, idx) => {
      const pageNum = typeof p.page === "number" ? p.page : idx + 1;
      const text = typeof p.text === "string" ? p.text.trim() : "";
      return {
        page: pageNum,
        fullText: text,
        quality: text.length > 20 ? ("high" as const) : ("low" as const),
        regions: [
          {
            id: `page${pageNum}_region1`,
            page: pageNum,
            text,
            kind: "text" as const,
            confidence: 0.85,
          },
        ],
      };
    });

    return {
      fileName,
      pageCount: pages.length,
      extractionProvider: this.name,
      createdAt: new Date().toISOString(),
      pages,
      title: bestTitle,
    } as ExtractedDocument & { title?: string };
  }
}
