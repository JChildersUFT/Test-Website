import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

// Until a custom domain is verified in Resend, fall back to Resend's shared
// onboarding sender. Swap this for noreply@yourdomain.com once the domain is
// set up and verified.
const FROM_ADDRESS = "UFT Spec Finder <onboarding@resend.dev>";
const FEEDBACK_TO = "jchilders@uft.com";

const MAX_FEEDBACK_CHARS = 5000;

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the RESEND_API_KEY environment variable." },
      { status: 500 }
    );
  }

  let body: { feedback?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const feedback =
    typeof body.feedback === "string" ? body.feedback.trim() : "";

  if (!feedback) {
    return NextResponse.json(
      { error: "Please enter some feedback before submitting." },
      { status: 400 }
    );
  }
  if (feedback.length > MAX_FEEDBACK_CHARS) {
    return NextResponse.json(
      { error: "That feedback is too long. Please shorten it." },
      { status: 400 }
    );
  }

  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "full",
    timeStyle: "long",
  });

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: FEEDBACK_TO,
      subject: "UFT Spec Finder Feedback",
      text: `${feedback}\n\n—\nSubmitted: ${timestamp}`,
    });

    if (error) {
      console.error("Resend feedback error:", error);
      return NextResponse.json(
        { error: "Could not send your feedback. Please try again later." },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("Feedback send error:", err);
    return NextResponse.json(
      { error: "Could not send your feedback. Please try again later." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
