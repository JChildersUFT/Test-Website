import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { buildResultsEmailHtml } from "@/lib/resultsEmail";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

export const runtime = "nodejs";

// Until a custom domain is verified in Resend, fall back to Resend's shared
// onboarding sender. Swap this for noreply@yourdomain.com once the domain is
// set up and verified.
const FROM_ADDRESS = "UFT Spec Finder <onboarding@resend.dev>";

// A reasonably permissive email check — just enough to reject obvious
// non-addresses before handing off to Resend.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asCompanyList(value: unknown): (KnownMatch & AiDetected)[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      company: typeof c.company === "string" ? c.company : "",
      pages: Array.isArray(c.pages)
        ? c.pages.filter((p): p is number => typeof p === "number")
        : [],
      specSection: typeof c.specSection === "string" ? c.specSection : undefined,
      products: typeof c.products === "string" ? c.products : undefined,
    }))
    .filter((c) => c.company.length > 0);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the RESEND_API_KEY environment variable." },
      { status: 500 }
    );
  }

  let body: {
    email?: unknown;
    summary?: unknown;
    knownMatches?: unknown;
    aiDetected?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  const summary = (body.summary ?? null) as ProjectSummary | null;
  const knownMatches = asCompanyList(body.knownMatches);
  const aiDetected = asCompanyList(body.aiDetected);

  const html = buildResultsEmailHtml({ summary, knownMatches, aiDetected });

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: summary?.projectName
        ? `UFT Spec Finder Results — ${summary.projectName}`
        : "UFT Spec Finder Results",
      html,
    });

    if (error) {
      console.error("Resend results error:", error);
      return NextResponse.json(
        { error: "Could not send the results email." },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("Results send error:", err);
    return NextResponse.json(
      { error: "Could not send the results email." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
