import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse-fork";
import Anthropic from "@anthropic-ai/sdk";
import { del, get } from "@vercel/blob";
import companiesData from "@/data/companies.json";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

export const runtime = "nodejs";

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

// Division 46 (Water and Wastewater Equipment) section headers show up in a
// lot of different forms across spec sheets — a running header with just
// the bare number, "SECTION 46" with inconsistent spacing, "DIVISION 46",
// or a section number that starts with 46 or 45. Deliberately loose: it's
// far cheaper to include an extra page than to silently drop a real one.
const DIVISION_46_PATTERNS = [
  /46\s*\d{4}/,
  /division\s*46/i,
  /section\s*46/i,
  /4[65]\s*\d{4}/i,
];

function isDivision46Page(text: string) {
  return DIVISION_46_PATTERNS.some((pattern) => pattern.test(text));
}

type PageText = { page: number; text: string };

function buildAnnotatedText(pageList: PageText[]) {
  return pageList
    .map((p) => `[Page ${p.page}]\n${p.text.replace(/\s+/g, " ").trim()}`)
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

  if (contentType.includes("application/json")) {
    let body: { blobUrl?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
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
    return await extractFromBytes(bytes);
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

async function extractFromBytes(bytes: Uint8Array): Promise<NextResponse> {
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

  if (!pages.some((p) => p.text.trim())) {
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

  // Pass 1 only ever looks at the front matter; Pass 2 only ever looks at
  // Division 46 pages. Page numbers in both passes refer to the original
  // document throughout — neither pass renumbers anything.
  const frontMatterPages = pages.filter((p) => p.page <= FRONT_MATTER_PAGE_LIMIT);
  let division46Pages = pages.filter((p) => isDivision46Page(p.text));

  console.log("Division 46 pages found:", division46Pages.length, "of", pages.length);

  if (division46Pages.length === 0) {
    console.warn("No Division 46 pages detected — falling back to full document");
    division46Pages = pages;
  }

  const [summary, aiCompanies] = await Promise.all([
    runSummaryPass(anthropic, frontMatterPages),
    runCompanyPass(anthropic, division46Pages),
  ]);

  // PDF extraction can introduce irregular whitespace (runs of spaces from
  // justified text, newlines at line-wrap points) that splits up phrases
  // which are visually contiguous, breaking a plain substring match.
  const knownMatches: KnownMatch[] = [];
  for (const company of KNOWN_COMPANIES) {
    const matchedPages = division46Pages
      .filter((p) => companyMatchesText(company, normalize(p.text)))
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

    const knownMatch = knownMatches.find((k) => namesOverlap(k.company, item.company));
    if (knownMatch) {
      if (item.specSection && item.specSection !== "Not found") {
        knownMatch.specSection = item.specSection;
      }
      if (item.products) {
        knownMatch.products = item.products;
      }
      continue;
    }

    aiDetected.push({
      company: item.company,
      pages: [...new Set(item.pages)].sort((a, b) => a - b),
      specSection: item.specSection && item.specSection !== "Not found" ? item.specSection : undefined,
      products: item.products || undefined,
    });
  }

  return NextResponse.json({ summary, knownMatches, aiDetected });
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
