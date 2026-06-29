"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import UploadZone from "./UploadZone";
import WaveDivider from "./WaveDivider";
import ResultsSection from "./ResultsSection";
import FeedbackSection from "./FeedbackSection";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";
type EmailStatus = "idle" | "sending" | "sent" | "error";

// Vercel's serverless functions cap request bodies at 4.5MB. Files under
// that go straight to /api/extract; larger ones upload directly to Blob
// storage from the browser first, and we send just the resulting URL.
const DIRECT_UPLOAD_LIMIT = 4.5 * 1024 * 1024;

export default function SpecFinderApp() {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [knownMatches, setKnownMatches] = useState<KnownMatch[]>([]);
  const [aiDetected, setAiDetected] = useState<AiDetected[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");

  const sendResultsEmail = async (
    to: string,
    results: {
      summary: ProjectSummary | null;
      knownMatches: KnownMatch[];
      aiDetected: AiDetected[];
    }
  ) => {
    setEmailStatus("sending");
    try {
      const res = await fetch("/api/send-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: to, ...results }),
      });
      if (!res.ok) throw new Error("send failed");
      setEmailStatus("sent");
    } catch {
      setEmailStatus("error");
    }
  };

  const handleFile = async (file: File) => {
    setStatus("loading");
    setFileName(file.name);
    setErrorMsg(null);
    setEmailStatus("idle");

    try {
      let res: Response;

      if (file.size < DIRECT_UPLOAD_LIMIT) {
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch("/api/extract", {
          method: "POST",
          body: formData,
        });
      } else {
        const blob = await upload(file.name, file, {
          access: "private",
          handleUploadUrl: "/api/upload-url",
          // Split large files into chunks uploaded in parallel (with retries).
          // Required for reliable uploads of files well beyond 50MB.
          multipart: true,
        });
        res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobUrl: blob.url }),
        });
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      const results = {
        summary: (data.summary ?? null) as ProjectSummary | null,
        knownMatches: (data.knownMatches ?? []) as KnownMatch[],
        aiDetected: (data.aiDetected ?? []) as AiDetected[],
      };

      setSummary(results.summary);
      setKnownMatches(results.knownMatches);
      setAiDetected(results.aiDetected);
      setStatus("done");

      const trimmedEmail = email.trim();
      if (trimmedEmail) {
        void sendResultsEmail(trimmedEmail, results);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setStatus("error");
    }
  };

  return (
    <>
      <section className="w-full bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h1 className="text-center text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Find every company in your spec sheets
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-center text-base text-secondary">
            Upload a spec sheet PDF and we&apos;ll surface every manufacturer
            and company it mentions, cross-checked against your known
            partner list.
          </p>

          <div className="mx-auto mt-10 max-w-md">
            <label
              htmlFor="results-email"
              className="block text-sm font-medium text-navy"
            >
              Email results to me{" "}
              <span className="font-normal text-secondary">(optional)</span>
            </label>
            <input
              id="results-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-lg border border-light-blue bg-white px-4 py-2.5 text-sm text-navy outline-none placeholder:text-secondary focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="mt-6">
            <UploadZone status={status} fileName={fileName} onFile={handleFile} />
          </div>

          {status === "done" && emailStatus !== "idle" && (
            <p
              className={`mt-4 text-center text-sm font-medium ${
                emailStatus === "error" ? "text-red-600" : "text-teal"
              }`}
              role="status"
            >
              {emailStatus === "sending" && "Emailing your results…"}
              {emailStatus === "sent" && `Results sent to ${email.trim()}.`}
              {emailStatus === "error" &&
                "We couldn't email your results, but they're shown below."}
            </p>
          )}
        </div>
      </section>

      <WaveDivider />

      <ResultsSection
        status={status}
        summary={summary}
        knownMatches={knownMatches}
        aiDetected={aiDetected}
        errorMsg={errorMsg}
      />

      <FeedbackSection />
    </>
  );
}
