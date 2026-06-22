import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse-fork";
import Anthropic from "@anthropic-ai/sdk";
import companiesData from "@/data/companies.json";
import type { AiDetected, KnownMatch } from "@/lib/types";

export const runtime = "nodejs";

const KNOWN_COMPANIES = companiesData as string[];
const MAX_TEXT_CHARS = 120_000;

function normalize(text: string) {
  return text.replace(/\s+/g, " ").toLowerCase().trim();
}

function namesOverlap(a: string, b: string) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

interface RawAiCompany {
  company: string;
  pages: number[];
  products: string[];
}

export async function POST(req: NextRequest) {
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

  // Must be a plain Uint8Array, not a Node Buffer: pdf-parse-fork's bundled
  // pdf.js assumes spec-compliant (copy) slice() semantics, which
  // Buffer.prototype.slice() does not provide (it returns a view).
  const bytes = new Uint8Array(await file.arrayBuffer());

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
    const needle = normalize(company);
    const matchedPages = pages
      .filter((p) => normalize(p.text).includes(needle))
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
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      tools: [
        {
          name: "list_companies",
          description:
            "Record every distinct company or manufacturer mentioned in the document, the page numbers it appears on, and the specific products or applications it is being specified for.",
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
                        "Page numbers (matching the [Page N] markers in the text) where this company is mentioned.",
                    },
                    products: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Specific products or applications this company's equipment is being specified for in this document (e.g. 'centrifugal self-priming pumps', 'waste activated sludge pumps'). Be specific, not generic.",
                    },
                  },
                  required: ["company", "pages", "products"],
                },
              },
            },
            required: ["companies"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "list_companies" },
      messages: [
        {
          role: "user",
          content: `Read the following equipment spec sheet text, annotated with [Page N] markers showing which page each block of text came from. List every company or manufacturer mentioned, the page numbers each appears on, and the specific products or applications it is being specified for in this document. Be specific about products/applications, not just the company name.\n\n${annotatedText}`,
        },
      ],
    });

    const toolUse = message.content.find(
      (block) => block.type === "tool_use"
    );
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { companies?: unknown };
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

  return NextResponse.json({ knownMatches, aiDetected });
}
