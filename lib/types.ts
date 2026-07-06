export interface KnownMatch {
  company: string;
  pages: number[];
  specSection?: string;
  products?: string;
}

export interface AiDetected {
  company: string;
  pages: number[];
  specSection?: string;
  products?: string;
}

export interface ProjectSummary {
  projectName: string;
  projectNumber: string;
  location: string;
  owner: string;
  engineer: string;
  bidDate: string;
  scopeOfWork: string;
}

// A single extracted PDF page. The client keeps the full array after upload so
// it can re-run the section filtering with a different format without
// re-parsing the PDF.
export interface PageText {
  page: number;
  text: string;
}

// Which section-filtering strategy Pass 2 uses. Chosen explicitly in the UI —
// there is no auto-detection.
export type SpecFormat = "division46" | "legacy" | "keyword" | "full";

export const SPEC_FORMAT_LABELS: Record<SpecFormat, string> = {
  division46: "Division 46 — New MasterFormat",
  legacy: "Division 11/13/15 — Legacy MasterFormat",
  keyword: "Keyword scan",
  full: "Full document",
};
