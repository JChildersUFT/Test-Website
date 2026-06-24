export interface KnownMatch {
  company: string;
  pages: number[];
  products?: string[];
}

export interface AiDetected {
  company: string;
  pages: number[];
  products: string[];
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
