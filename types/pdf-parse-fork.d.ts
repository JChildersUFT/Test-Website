declare module "pdf-parse-fork" {
  interface PdfTextItem {
    str: string;
    transform: number[];
  }

  interface PdfTextContent {
    items: PdfTextItem[];
  }

  interface PdfPageProxy {
    pageNumber: number;
    getTextContent(options?: {
      normalizeWhitespace?: boolean;
      disableCombineTextItems?: boolean;
    }): Promise<PdfTextContent>;
  }

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
    pagerender?: (pageData: PdfPageProxy) => string | Promise<string>;
  }

  function pdfParse(
    dataBuffer: Uint8Array,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;

  export = pdfParse;
}
