"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import UploadZone from "./UploadZone";
import WaveDivider from "./WaveDivider";
import ResultsSection from "./ResultsSection";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

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

  const handleFile = async (file: File) => {
    setStatus("loading");
    setFileName(file.name);
    setErrorMsg(null);

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

      setSummary(data.summary ?? null);
      setKnownMatches(data.knownMatches ?? []);
      setAiDetected(data.aiDetected ?? []);
      setStatus("done");
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

          <div className="mt-10">
            <UploadZone status={status} fileName={fileName} onFile={handleFile} />
          </div>
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
    </>
  );
}
