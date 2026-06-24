import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse-fork";
import Anthropic from "@anthropic-ai/sdk";
import { del, get } from "@vercel/blob";
import companiesData from "@/data/companies.json";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

export const runtime = "nodejs";

const KNOWN_COMPANIES = companiesData as string[];
const MAX_TEXT_CHARS = 120_000;
// Acronyms this short (SSI, GEA, VPC, AWC, ...) need a word-boundary match —
// a plain substring check would also fire inside unrelated longer words.
const SHORT_NAME_LENGTH = 4;

function normalize(text: string) {
  return text.replace(/\s+/g, " ").toLowerCase().trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function companyMatchesText(company: string, normalizedText: string) {
  const needle = normalize(company);
  if (company.length <= SHORT_NAME_LENGTH) {
    return new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(normalizedText);
  }
  return normalizedText.includes(needle);
}

function namesOverlap(a: string, b: string) {
  const na = normalize(a);
  const nb = normalize(b);
  if (a.length <= SHORT_NAME_LENGTH || b.length <= SHORT_NAME_LENGTH) {
    const containsWhole = (needle: string, haystack: string) =>
      new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(haystack);
    return containsWhole(na, nb) || containsWhole(nb, na);
  }
  return na.includes(nb) || nb.includes(na);
}

interface RawAiCompany {
  company: string;
  pages: number[];
  products: string[];
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
  const pages: { page: number; text: string }[] = [];

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

  // PDF extraction can introduce irregular whitespace (runs of spaces from
  // justified text, newlines at line-wrap points) that splits up phrases
  // which are visually contiguous, breaking a plain substring match.
  const knownMatches: KnownMatch[] = [];
  for (const company of KNOWN_COMPANIES) {
    const matchedPages = pages
      .filter((p) => companyMatchesText(company, normalize(p.text)))
      .map((p) => p.page);
    if (matchedPages.length > 0) {
      knownMatches.push({ company, pages: matchedPages });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the ANTHROPIC_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const annotatedText = pages
    .map((p) => `[Page ${p.page}]\n${p.text.replace(/\s+/g, " ").trim()}`)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARS);

  let aiCompanies: RawAiCompany[] = [];
  let summary: ProjectSummary = sanitizeSummary(undefined);
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [
        {
          name: "extract_spec_sheet_info",
          description:
            "Record the project summary and every distinct company or manufacturer mentioned in the document, the page numbers each appears on, and the specific products or applications each is being specified for.",
          input_schema: {
            type: "object",
            properties: {
              summary: {
                type: "object",
                description:
                  "Project-level information, typically found on a cover page, title sheet, or in general/bid information sections. Use the exact string \"Not found\" for any field that is not present in the document.",
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
                        "Page numbers (matching the [Page N] markers in the text) where this company is mentioned.",
                    },
                    products: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Specific products or applications this company's equipment is being specified for, based on the surrounding spec section (section number, section title, and the paragraph the mention appears in). Include the spec section number and title when visible, e.g. 'Section 46 5103 - Air Diffusers: coarse bubble diffusers for sludge holding tank aeration'. Describe the actual application, not just a generic product category or the company name alone.",
                    },
                  },
                  required: ["company", "pages", "products"],
                },
              },
            },
            required: ["summary", "companies"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_spec_sheet_info" },
      messages: [
        {
          role: "user",
          content: `Read the following equipment spec sheet text, annotated with [Page N] markers showing which page each block of text came from.

1. Extract a project summary: project name, project number, location, owner, engineer, bid date, and scope of work. Look at the cover page, title sheet, or general/bid information sections. Use "Not found" for any field that isn't present in the document.

2. List every company or manufacturer mentioned, the page numbers each appears on, and the specific products or applications it is being specified for. Look at the surrounding spec section (section number, section title, and the paragraph around the mention) to determine what the company's equipment is actually being used for. Include the spec section number and title when visible (e.g. "Section 46 5103 - Air Diffusers"). Be specific about the product/application — e.g. "coarse bubble diffusers for sludge holding tank aeration" rather than just "diffusers" or just the company name.

${annotatedText}`,
        },
      ],
    });

    const toolUse = message.content.find(
      (block) => block.type === "tool_use"
    );
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { summary?: unknown; companies?: unknown };
      summary = sanitizeSummary(input.summary);
      if (Array.isArray(input.companies)) {
        aiCompanies = input.companies
          .filter(
            (c): c is Record<string, unknown> =>
              typeof c === "object" && c !== null
          )
          .map((c) => ({
            company: typeof c.company === "string" ? c.company.trim() : "",
            pages: Array.isArray(c.pages)
              ? c.pages.filter((p): p is number => typeof p === "number")
              : [],
            products: Array.isArray(c.products)
              ? c.products.filter(
                  (p): p is string => typeof p === "string" && p.trim().length > 0
                )
              : [],
          }))
          .filter((c) => c.company.length > 0);
      }
    }
  } catch (err) {
    console.error("Anthropic API error:", err);
    return NextResponse.json(
      { error: "The AI analysis failed. Please try again." },
      { status: 502 }
    );
  }

  const seen = new Set<string>();
  const aiDetected: AiDetected[] = [];

  for (const item of aiCompanies) {
    const key = normalize(item.company);
    if (seen.has(key)) continue;
    seen.add(key);

    const knownMatch = knownMatches.find((k) => namesOverlap(k.company, item.company));
    if (knownMatch) {
      if (item.products.length > 0) {
        knownMatch.products = [...new Set([...(knownMatch.products ?? []), ...item.products])];
      }
      continue;
    }

    aiDetected.push({
      company: item.company,
      pages: [...new Set(item.pages)].sort((a, b) => a - b),
      products: item.products,
    });
  }

  return NextResponse.json({ summary, knownMatches, aiDetected });
}
