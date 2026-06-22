declare module "pdf-parse-fork" {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
    text: string;
  }

  interface PdfParseOptions {
    max?: number;
  }

  function pdfParse(
    dataBuffer: Uint8Array,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;

  export = pdfParse;
}
