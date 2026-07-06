import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse-fork";
import Anthropic from "@anthropic-ai/sdk";
import { del, get } from "@vercel/blob";
import companiesData from "@/data/companies.json";
import type {
  AiDetected,
  KnownMatch,
  PageText,
  ProjectSummary,
  SpecFormat,
} from "@/lib/types";

export const runtime = "nodejs";
// Large PDFs (50MB+) take longer to download from Blob, parse, and run two
// Claude passes over. Claim the full 5-minute function timeout instead of the
// platform default.
export const maxDuration = 300;

const KNOWN_COMPANIES = companiesData as string[];
const MAX_TEXT_CHARS = 120_000;
const FRONT_MATTER_PAGE_LIMIT = 15;
const MODEL = "claude-sonnet-4-6";

// Acronyms this short (SSI, GEA, VPC, AWC, Aqua, ...) need a word-boundary
// match — a plain substring check would also fire inside unrelated words.
const SHORT_NAME_LENGTH = 4;

// These names are also common English words or generic terms. Even though
// they're longer than the short-acronym threshold, a plain substring match
// would false-positive on unrelated text (e.g. "United" inside "United
// States", "Johnson" as a surname). Force a whole-phrase, word-boundary
// match for them too.
const GENERIC_FULL_PHRASE_NAMES = new Set(
  [
    "Nordic Water",
    "Force Flow",
    "United Flo",
    "Johnson Screens",
    "Gardner Denver",
    "Daniel Company",
    "Orthos",
    "Marcab",
  ].map((name) => normalize(name))
);

function normalize(text: string) {
  return text.replace(/\s+/g, " ").toLowerCase().trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiresWordBoundary(company: string) {
  return (
    company.length <= SHORT_NAME_LENGTH ||
    GENERIC_FULL_PHRASE_NAMES.has(normalize(company))
  );
}

// Returns true if `company` appears in `normalizedText` (text that has already
// been run through normalize()). Matching rules, in priority order:
//
//   1. Multi-word names ("Cornell Pump", "Trojan Technologies"): require a word
//      boundary at the START only and leave the end open, so the list entry
//      "Cornell Pump" still matches when the document writes the fuller form
//      "Cornell Pump Company" / "Inc." / "LLC". The leading \b keeps the first
//      word from firing inside an unrelated word (so "Cornell" never matches
//      "Cornellville").
//   2. Short acronyms and single-word generic terms (SSI, Aqua, Orthos): require
//      a boundary on BOTH ends so they don't match inside larger words.
//   3. Everything else: a plain substring check.
function companyMatchesText(company: string, normalizedText: string) {
  const needle = normalize(company);
  if (needle.includes(" ")) {
    return new RegExp(`\\b${escapeRegExp(needle)}`, "i").test(normalizedText);
  }
  if (requiresWordBoundary(company)) {
    return new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(normalizedText);
  }
  return normalizedText.includes(needle);
}

// Two names refer to the same company if either one matches inside the other
// under the same rules used to match against document text. This lets the list
// entry "Cornell Pump" dedupe against the AI's "Cornell Pump Company".
function namesOverlap(a: string, b: string) {
  return (
    companyMatchesText(a, normalize(b)) || companyMatchesText(b, normalize(a))
  );
}

// Division 46 (Water & Wastewater Equipment) section-number detection. A page
// matches on any of: a section header, a "46 xxxx" footer / cross-reference, a
// space-stripped "46xxxx", or a "46 xxxx/N of M" page footer. The section
// number alone is sufficient — no spec-heading confirmation is required.
const DIVISION_46_PATTERNS = [
  /SECTION\s+46\s+\d{4}/i,       // header:          SECTION 46 0526
  /\b46\s+\d{4}/,               // footer / xref:   46 0526
  /\b46\d{4}\b/,                // spaces stripped: 460526
  /46\s*\d{4}\/\d+\s+of\s+\d+/i, // page footer:     46 0526/1 of 6
];

function isDivision46Page(text: string) {
  return DIVISION_46_PATTERNS.some((pattern) => pattern.test(text));
}

// pdf-parse-fork hands us page objects, but defend against alternate shapes
// (a raw string, or a `content` field) so text access never silently yields
// undefined. Our own pagerender always produces { page, text }.
function getPageText(page: unknown): string {
  if (typeof page === "string") return page;
  if (page && typeof page === "object") {
    const record = page as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Format-specific page selection
//
// The spec format is chosen explicitly in the UI (see selectPagesForFormat) —
// there is no auto-detection. The helpers below back the individual modes and
// the appendix cutoff.
// ---------------------------------------------------------------------------

// Broad legacy MasterFormat (pre-2004) 5-digit detection covering divisions
// 02/11/13/15/17/26. This is the wide "is there real spec content here" check
// used by the appendix cutoff — deliberately broader than the narrow Division
// 11/13/15 selection mode. All three ways a legacy section number appears are
// recognized (header, interior subsection ref 11226.03, page footer 11226 - 2)
// and each is range-checked against a legacy division.
const LEGACY_5DIGIT_PATTERNS = [
  /\bSECTION\s+(\d{5})\b/gi, // header:      SECTION 11226
  /\b(\d{5})\.\d{2}\b/g,     // subsection:  11226.03
  /\b(\d{5})\s*-\s*\d+\b/g,  // page footer: 11226 - 2
];

// Legacy water/wastewater divisions: 02 (site work / utilities), 11 (equipment),
// 13 (special construction), 15 (mechanical), 17 (instrumentation), 26 (electrical).
function isLegacyDivision(section: number) {
  return (
    (section >= 2000 && section <= 2999) ||
    (section >= 11000 && section <= 11999) ||
    (section >= 13000 && section <= 13999) ||
    (section >= 15000 && section <= 15999) ||
    (section >= 17000 && section <= 17999) ||
    (section >= 26000 && section <= 26999)
  );
}

function isLegacy5DigitPage(text: string) {
  for (const pattern of LEGACY_5DIGIT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (isLegacyDivision(Number(match[1]))) return true;
    }
  }
  return false;
}

// A page carries a real spec section if it matches Division 46 or a legacy
// 5-digit section number — used to find where the real spec content ends.
function isSpecSectionPage(text: string) {
  return isDivision46Page(text) || isLegacy5DigitPage(text);
}

// Seeds the Tier 3 keyword list below; no longer gates Tier 2b.
const PROCESS_KEYWORDS = [
  "pump",
  "valve",
  "chemical",
  "filter",
  "uv",
  "disinfection",
  "piping",
  "blower",
  "aeration",
  "treatment",
];

// Keyword-scan vocabulary: process/equipment terms plus broader water /
// wastewater spec words. Used by the "Keyword scan" format mode.
const TIER3_KEYWORDS = [
  ...PROCESS_KEYWORDS,
  "water treatment",
  "vertical turbine",
  "inline mixer",
  "cartridge filter",
  "chemical feed system",
  "well pump",
  "elevated tank",
  "vfd",
  "variable frequency",
  "instrumentation",
  "scada",
  "telemetry",
  "fittings",
  "hangers",
  "supports",
  "coatings",
  "painting",
  "approved equal",
  "basis of design",
];

function keywordMatchCount(text: string) {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const keyword of TIER3_KEYWORDS) {
    if (lower.includes(keyword)) hits += 1;
  }
  return hits;
}

// PDF text is extracted one page at a time, so a section header often lands on
// a different page than the manufacturer list it introduces. Once a section is
// detected on a page, also pull in the next few pages (in document order) so
// lists that spill across page breaks are captured.
const SECTION_LOOKAHEAD_PAGES = 3;

// Given a per-index trigger flag, return every triggered page plus the next
// SECTION_LOOKAHEAD_PAGES pages after it, de-duplicated and in document order.
function carryForward(allPages: PageText[], triggers: boolean[]): PageText[] {
  const included = new Set<number>();
  for (let i = 0; i < allPages.length; i++) {
    if (!triggers[i]) continue;
    const end = Math.min(i + SECTION_LOOKAHEAD_PAGES, allPages.length - 1);
    for (let j = i; j <= end; j++) included.add(j);
  }
  return [...included].sort((a, b) => a - b).map((i) => allPages[i]);
}

// Legacy Division 11/13/15 selection mode: pre-2004 equipment sections numbered
// 11xxx / 13xxx / 15xxx / 17xxx, via section headers, interior subsection refs,
// and page-footer refs.
const LEGACY_MODE_PATTERNS = [
  /SECTION\s+1[1357]\d{3}/i,    // header:      SECTION 11226
  /\b1[1357]\d{3}\.\d{2}\b/,    // subsection:  11226.03
  /\b1[1357]\d{3}\s*-\s*\d+\b/, // page footer: 11226 - 2
];

function isLegacyModePage(text: string) {
  return LEGACY_MODE_PATTERNS.some((pattern) => pattern.test(text));
}

// Minimum distinct keyword hits for the keyword-scan mode to include a page.
const KEYWORD_MODE_MIN = 2;

// Selects the pages fed to Pass 2 based on the user-chosen spec format. The
// appendix cutoff has already been applied by the caller.
function selectPagesForFormat(allPages: PageText[], format: SpecFormat): PageText[] {
  switch (format) {
    case "division46": {
      // Any page carrying a Division 46 section number; matched pages carry
      // forward to capture manufacturer lists on the following pages.
      const triggers = allPages.map((p) => isDivision46Page(getPageText(p)));
      return carryForward(allPages, triggers);
    }
    case "legacy": {
      const triggers = allPages.map((p) => isLegacyModePage(getPageText(p)));
      return carryForward(allPages, triggers);
    }
    case "keyword":
      return allPages.filter(
        (p) => keywordMatchCount(getPageText(p)) >= KEYWORD_MODE_MIN
      );
    case "full":
    default:
      return allPages;
  }
}

const APPENDIX_SCAN_WINDOW = 150;

// Signals that a page is appendix / meeting-transcript / contract boilerplate
// rather than spec content. The email and "General Conditions" signals also
// appear on legitimate spec pages, so the cutoff is only applied after the last
// real spec section (see findAppendixCutoff).
const APPENDIX_SIGNALS: RegExp[] = [
  /In-Meeting Duration/i,
  /Participants/i,
  /\S+@\S+\.\S+/, // any email address
  /General Conditions/i,
  /Insurance Requirements/i,
  /REVISED 10\/202/i,
  /GC\/\d+/i, // GC/28, GC/48
];

function hasAppendixSignal(text: string) {
  return APPENDIX_SIGNALS.some((pattern) => pattern.test(text));
}

// Index of the first page (within the last APPENDIX_SCAN_WINDOW pages) that
// looks like appendix / transcript content — that page and everything after it
// should be discarded. Returns -1 when there's nothing to cut. The scan never
// starts at or before the last real spec-section page, so a stray email or
// "General Conditions" reference on a genuine spec page can't gut the document.
function findAppendixCutoff(allPages: PageText[]): number {
  const n = allPages.length;
  if (n === 0) return -1;

  let lastSpecIdx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (isSpecSectionPage(getPageText(allPages[i]))) {
      lastSpecIdx = i;
      break;
    }
  }

  const scanStart = Math.max(n - APPENDIX_SCAN_WINDOW, lastSpecIdx + 1);
  for (let i = scanStart; i < n; i++) {
    if (hasAppendixSignal(getPageText(allPages[i]))) return i;
  }
  return -1;
}

// Coerce an untrusted request value to a valid SpecFormat, defaulting to
// Division 46 (the UI default).
function parseFormat(value: unknown): SpecFormat {
  return value === "legacy" || value === "keyword" || value === "full"
    ? value
    : "division46";
}

function buildAnnotatedText(pageList: PageText[]) {
  return pageList
    .map((p) => `[Page ${p.page}]\n${getPageText(p).replace(/\s+/g, " ").trim()}`)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARS);
}

const SUMMARY_FIELDS = [
  "projectName",
  "projectNumber",
  "location",
  "owner",
  "engineer",
  "bidDate",
  "scopeOfWork",
] as const;

function sanitizeSummaryField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "Not found";
}

function sanitizeSummary(value: unknown): ProjectSummary {
  const raw = (value ?? {}) as Record<string, unknown>;
  const summary = {} as ProjectSummary;
  for (const field of SUMMARY_FIELDS) {
    summary[field] = sanitizeSummaryField(raw[field]);
  }
  return summary;
}

interface RawAiCompany {
  company: string;
  pages: number[];
  specSection: string;
  products: string;
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  let bytes: Uint8Array;
  let blobUrl: string | null = null;
  let format: SpecFormat = "division46";

  if (contentType.includes("application/json")) {
    let body: { blobUrl?: unknown; pages?: unknown; format?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
    }
    format = parseFormat(body.format);

    // Re-analysis: the client sends back the pages it already extracted so we
    // re-run only Pass 2 with a new format, without re-parsing the PDF.
    if (Array.isArray(body.pages)) {
      return await reanalyze(body.pages, format);
    }

    if (typeof body.blobUrl !== "string" || !body.blobUrl) {
      return NextResponse.json(
        { error: "No blob URL was provided." },
        { status: 400 }
      );
    }
    blobUrl = body.blobUrl;

    let blobResult: Awaited<ReturnType<typeof get>>;
    try {
      blobResult = await get(blobUrl, { access: "private" });
    } catch (err) {
      console.error("Blob fetch error:", err);
      return NextResponse.json(
        { error: "Could not download the uploaded PDF." },
        { status: 502 }
      );
    }
    if (!blobResult || blobResult.statusCode !== 200) {
      return NextResponse.json(
        { error: "Could not download the uploaded PDF." },
        { status: 502 }
      );
    }

    // Must be a plain Uint8Array, not a Node Buffer: pdf-parse-fork's bundled
    // pdf.js assumes spec-compliant (copy) slice() semantics, which
    // Buffer.prototype.slice() does not provide (it returns a view).
    bytes = new Uint8Array(await new Response(blobResult.stream).arrayBuffer());
  } else {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
    }

    format = parseFormat(formData.get("format"));

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No PDF file was provided." },
        { status: 400 }
      );
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Please upload a PDF file." },
        { status: 400 }
      );
    }

    bytes = new Uint8Array(await file.arrayBuffer());
  }

  try {
    return await extractFromBytes(bytes, format);
  } finally {
    if (blobUrl) {
      try {
        await del(blobUrl);
      } catch (err) {
        console.error("Blob delete error:", err);
      }
    }
  }
}

async function extractFromBytes(
  bytes: Uint8Array,
  format: SpecFormat
): Promise<NextResponse> {
  const pages: PageText[] = [];

  try {
    await pdfParse(bytes, {
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        });

        let lastY: number | undefined;
        let text = "";
        for (const item of textContent.items) {
          if (lastY === undefined || lastY === item.transform[5]) {
            text += item.str;
          } else {
            text += "\n" + item.str;
          }
          lastY = item.transform[5];
        }

        pages.push({ page: pageData.pageNumber, text });
        return text;
      },
    });
  } catch (err) {
    console.error("PDF parse error:", err);
    return NextResponse.json(
      { error: "Could not read that PDF. It may be corrupted or scanned as an image." },
      { status: 422 }
    );
  }

  pages.sort((a, b) => a.page - b.page);

  if (!pages.some((p) => getPageText(p).trim())) {
    return NextResponse.json(
      { error: "No readable text found in that PDF." },
      { status: 422 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the ANTHROPIC_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  // Debug: surface exactly what pdf-parse-fork returned and whether the legacy
  // 5-digit patterns match, to diagnose detection misses. Runs on the raw
  // pages before any trimming.
  console.log("Sample page 1 text (first 200 chars):", getPageText(pages[0]).substring(0, 200));
  console.log("Sample page 5 text (first 200 chars):", getPageText(pages[4]).substring(0, 200));
  console.log("Total pages from pdf-parse-fork:", pages.length);
  pages.slice(0, 10).forEach((page, i) => {
    const text = getPageText(page);
    console.log(`Page ${i + 1} - has SECTION pattern:`, /SECTION\s+\d{5}/i.test(text));
    console.log(`Page ${i + 1} - has subsection pattern:`, /\d{5}\.\d{2}/.test(text));
    console.log(`Page ${i + 1} - has footer pattern:`, /\d{5}\s*-\s*\d+/.test(text));
    console.log(`Page ${i + 1} text preview:`, text.substring(0, 100));
  });

  // Focused debug for the mid-document pages the legacy 5-digit sections are
  // expected on.
  [360, 361, 362, 363, 364, 365].forEach((pageNum) => {
    const page = pages[pageNum - 1];
    const text = getPageText(page);
    console.log(`Page ${pageNum} - SECTION pattern:`, /SECTION\s+\d{5}/i.test(text));
    console.log(`Page ${pageNum} - subsection pattern:`, /\b\d{5}\.\d{2}\b/.test(text));
    console.log(`Page ${pageNum} - footer pattern:`, /\b\d{5}\s*-\s*\d+\b/.test(text));
    console.log(`Page ${pageNum} preview:`, text.substring(0, 150));
  });

  // Pass 1 (summary) always looks at the front matter and is independent of the
  // chosen format. Pass 2 filters by format and runs the company pass. Both run
  // in parallel. Page numbers refer to the original document throughout.
  const frontMatterPages = pages.filter((p) => p.page <= FRONT_MATTER_PAGE_LIMIT);

  const [summary, pass2] = await Promise.all([
    runSummaryPass(anthropic, frontMatterPages),
    runPass2(anthropic, pages, format),
  ]);

  // Return the full extracted pages so the client can re-run Pass 2 with a
  // different format without re-uploading / re-parsing the PDF.
  return NextResponse.json({ summary, ...pass2, pages, format });
}

// Re-run only Pass 2 against pages the client already extracted, for a format
// change. Skips PDF parsing and the summary pass entirely.
async function reanalyze(
  rawPages: unknown[],
  format: SpecFormat
): Promise<NextResponse> {
  const pages: PageText[] = rawPages
    .map((p) => {
      const record = p as { page?: unknown };
      return {
        page: typeof record?.page === "number" ? record.page : 0,
        text: getPageText(p),
      };
    })
    .filter((p) => p.text.length > 0);

  if (pages.length === 0) {
    return NextResponse.json(
      { error: "No page text provided for re-analysis." },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the ANTHROPIC_API_KEY environment variable." },
      { status: 500 }
    );
  }
  const anthropic = new Anthropic({ apiKey });

  const pass2 = await runPass2(anthropic, pages, format);
  return NextResponse.json({ ...pass2, format });
}

// Pass 2: apply the appendix cutoff (all modes), select pages for the chosen
// format, run the company pass, and reconcile against the known-partner list.
async function runPass2(
  anthropic: Anthropic,
  allPages: PageText[],
  format: SpecFormat
): Promise<{ knownMatches: KnownMatch[]; aiDetected: AiDetected[] }> {
  // Hard appendix/transcript cutoff — runs for every format.
  let workingPages = allPages;
  const cutoffIdx = findAppendixCutoff(allPages);
  if (cutoffIdx !== -1) {
    const cutoffPage = allPages[cutoffIdx].page;
    console.log(
      "Appendix cutoff detected at page:",
      cutoffPage,
      "— discarding remaining",
      allPages.length - cutoffPage,
      "pages"
    );
    workingPages = allPages.slice(0, cutoffIdx);
  }

  const relevantPages = selectPagesForFormat(workingPages, format);
  console.log(
    "Format:",
    format,
    "| Pages selected:",
    relevantPages.length,
    "of",
    workingPages.length
  );

  const aiCompanies = await runCompanyPass(anthropic, relevantPages);

  // PDF extraction can introduce irregular whitespace (runs of spaces from
  // justified text, newlines at line-wrap points) that splits up phrases
  // which are visually contiguous, breaking a plain substring match.
  const knownMatches: KnownMatch[] = [];
  for (const company of KNOWN_COMPANIES) {
    const matchedPages = relevantPages
      .filter((p) => companyMatchesText(company, normalize(getPageText(p))))
      .map((p) => p.page);
    if (matchedPages.length > 0) {
      knownMatches.push({ company, pages: matchedPages });
    }
  }

  const seen = new Set<string>();
  const aiDetected: AiDetected[] = [];

  for (const item of aiCompanies) {
    const key = normalize(item.company);
    if (seen.has(key)) continue;
    seen.add(key);

    const aiPages = [...new Set(item.pages)].sort((a, b) => a - b);
    const specSection =
      item.specSection && item.specSection !== "Not found" ? item.specSection : undefined;
    const products = item.products || undefined;

    // First try to attach to a known partner the verbatim page-scan already
    // found above.
    let knownMatch = knownMatches.find((k) => namesOverlap(k.company, item.company));

    // The page-scan only finds names that appear word-for-word in the text. The
    // AI often returns a canonicalized/expanded name (e.g. "Cornell Pump
    // Company" when the page says "Cornell", or a name that wrapped a line),
    // so cross-reference the AI's name against the full known-partner list too.
    // If it's a known partner, promote it to a known match under the list's
    // canonical name instead of dropping it into "other companies".
    if (!knownMatch) {
      const canonical = KNOWN_COMPANIES.find((c) => namesOverlap(c, item.company));
      if (canonical) {
        knownMatch = { company: canonical, pages: aiPages };
        knownMatches.push(knownMatch);
      }
    }

    if (knownMatch) {
      if (knownMatch.pages.length === 0) knownMatch.pages = aiPages;
      if (specSection) knownMatch.specSection = specSection;
      if (products) knownMatch.products = products;
      continue;
    }

    aiDetected.push({
      company: item.company,
      pages: aiPages,
      specSection,
      products,
    });
  }

  return { knownMatches, aiDetected };
}

async function runSummaryPass(
  anthropic: Anthropic,
  frontMatterPages: PageText[]
): Promise<ProjectSummary> {
  if (frontMatterPages.length === 0) {
    return sanitizeSummary(undefined);
  }

  const annotatedText = buildAnnotatedText(frontMatterPages);

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [
        {
          name: "extract_project_summary",
          description:
            "Extract project-level summary information from the front matter of a specification document.",
          input_schema: {
            type: "object",
            properties: {
              projectName: { type: "string" },
              projectNumber: { type: "string" },
              location: { type: "string" },
              owner: { type: "string" },
              engineer: { type: "string" },
              bidDate: { type: "string" },
              scopeOfWork: {
                type: "string",
                description: "A brief description of the overall scope of work covered by this document.",
              },
            },
            required: [
              "projectName",
              "projectNumber",
              "location",
              "owner",
              "engineer",
              "bidDate",
              "scopeOfWork",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_project_summary" },
      messages: [
        {
          role: "user",
          content: `The following is the front matter of a specification document (cover page, title sheet, general/bid information), annotated with [Page N] markers showing the original page number each block of text came from. Extract the project name, project number, location, owner, engineer, bid date, and scope of work. Use "Not found" for any field that isn't present in this text.\n\n${annotatedText}`,
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return sanitizeSummary(toolUse.input);
    }
  } catch (err) {
    console.error("Summary pass error:", err);
  }

  return sanitizeSummary(undefined);
}

async function runCompanyPass(
  anthropic: Anthropic,
  division46Pages: PageText[]
): Promise<RawAiCompany[]> {
  if (division46Pages.length === 0) {
    return [];
  }

  const annotatedText = buildAnnotatedText(division46Pages);

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [
        {
          name: "extract_companies",
          description:
            "Record every distinct company or manufacturer mentioned in this Division 46 (Water and Wastewater Equipment) spec text, the page numbers each appears on, its spec section, and the specific product or application it is being specified for.",
          input_schema: {
            type: "object",
            properties: {
              companies: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    company: {
                      type: "string",
                      description: "Company or manufacturer name.",
                    },
                    pages: {
                      type: "array",
                      items: { type: "integer" },
                      description:
                        "Page numbers (matching the [Page N] markers in the text, i.e. the original document's page numbers) where this company is mentioned.",
                    },
                    specSection: {
                      type: "string",
                      description:
                        "The spec section number and title this mention falls under, e.g. 'Section 46 5103 - Air Diffusers'. Use \"Not found\" if no section heading is visible near the mention.",
                    },
                    products: {
                      type: "string",
                      description:
                        "A specific description of the product or application this company's equipment is being specified for, based on the surrounding section and paragraph, e.g. 'Coarse bubble diffusers for sludge holding tank aeration'. Describe the actual application, not just a generic product category or the company name alone.",
                    },
                  },
                  required: ["company", "pages", "specSection", "products"],
                },
              },
            },
            required: ["companies"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_companies" },
      messages: [
        {
          role: "user",
          content: `The following is Division 46 (Water and Wastewater Equipment) text extracted from a specification document, annotated with [Page N] markers showing the original page number each block of text came from.

For every company or manufacturer mentioned:
- Look at the surrounding spec section number and title for each mention.
- Describe the specific product or application it is being specified for, not just the company name.
- Use the original page numbers shown in the [Page N] markers.

${annotatedText}`,
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { companies?: unknown };
      if (Array.isArray(input.companies)) {
        return input.companies
          .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
          .map((c) => ({
            company: typeof c.company === "string" ? c.company.trim() : "",
            pages: Array.isArray(c.pages)
              ? c.pages.filter((p): p is number => typeof p === "number")
              : [],
            specSection: typeof c.specSection === "string" ? c.specSection.trim() : "Not found",
            products: typeof c.products === "string" ? c.products.trim() : "",
          }))
          .filter((c) => c.company.length > 0);
      }
    }
  } catch (err) {
    console.error("Company pass error:", err);
  }

  return [];
}
