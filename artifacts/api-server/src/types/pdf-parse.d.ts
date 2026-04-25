declare module "pdf-parse" {
  interface PdfPageProxyLike {
    getTextContent(options?: Record<string, unknown>): Promise<{
      items: Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>;
    }>;
  }

  interface PdfParseOptions {
    pagerender?: (pageData: PdfPageProxyLike) => Promise<string>;
    max?: number;
    version?: string;
  }

  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
    text: string;
  }

  function pdfParse(dataBuffer: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;

  export default pdfParse;
}
