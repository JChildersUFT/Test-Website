import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse-fork";
import Anthropic from "@anthropic-ai/sdk";
import companiesData from "@/data/companies.json";

export const runtime = "nodejs";

const KNOWN_COMPANIES = companiesData as string[];
const MAX_TEXT_CHARS = 120_000;

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

  let text: string;
  try {
    const result = await pdfParse(bytes);
    text = result.text.trim();
  } catch (err) {
    console.error("PDF parse error:", err);
    return NextResponse.json(
      { error: "Could not read that PDF. It may be corrupted or scanned as an image." },
      { status: 422 }
    );
  }

  if (!text) {
    return NextResponse.json(
      { error: "No readable text found in that PDF." },
      { status: 422 }
    );
  }

  // PDF extraction can introduce irregular whitespace (runs of spaces from
  // justified text, newlines at line-wrap points) that splits up phrases
  // which are visually contiguous, breaking a plain substring match.
  const normalizedText = text.replace(/\s+/g, " ").toLowerCase();
  const knownMatches = KNOWN_COMPANIES.filter((company) =>
    normalizedText.includes(company.replace(/\s+/g, " ").toLowerCase())
  );

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the ANTHROPIC_API_KEY environment variable." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  let aiCompanies: string[] = [];
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [
        {
          name: "list_companies",
          description:
            "Record every distinct company or manufacturer name mentioned in the document text.",
          input_schema: {
            type: "object",
            properties: {
              companies: {
                type: "array",
                items: { type: "string" },
                description:
                  "Company or manufacturer names mentioned in the text. No product names, model numbers, or generic terms. Deduplicated.",
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
          content: `Read the following equipment spec sheet text and list every company or manufacturer name mentioned in it.\n\n${text.slice(
            0,
            MAX_TEXT_CHARS
          )}`,
        },
      ],
    });

    const toolUse = message.content.find(
      (block) => block.type === "tool_use"
    );
    if (toolUse && toolUse.type === "tool_use") {
      const input = toolUse.input as { companies?: unknown };
      if (Array.isArray(input.companies)) {
        aiCompanies = input.companies.filter(
          (c): c is string => typeof c === "string"
        );
      }
    }
  } catch (err) {
    console.error("Anthropic API error:", err);
    return NextResponse.json(
      { error: "The AI analysis failed. Please try again." },
      { status: 502 }
    );
  }

  const isCoveredByKnownList = (name: string) =>
    KNOWN_COMPANIES.some(
      (company) =>
        name.toLowerCase().includes(company.toLowerCase()) ||
        company.toLowerCase().includes(name.toLowerCase())
    );

  const seen = new Set<string>();
  const aiDetected: string[] = [];
  for (const name of aiCompanies) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key) || isCoveredByKnownList(trimmed)) continue;
    seen.add(key);
    aiDetected.push(trimmed);
  }

  return NextResponse.json({ knownMatches, aiDetected });
}
