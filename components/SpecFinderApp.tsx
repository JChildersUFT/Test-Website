"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import UploadZone from "./UploadZone";
import WaveDivider from "./WaveDivider";
import ResultsSection from "./ResultsSection";
import FeedbackSection from "./FeedbackSection";
import SpecFormatSelector from "./SpecFormatSelector";
import type {
  AiDetected,
  KnownMatch,
  PageText,
  ProductMatch,
  ProjectSummary,
  SpecFormat,
} from "@/lib/types";

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
  const [products, setProducts] = useState<ProductMatch[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected format drives the next analysis; activeFormat is the one that
  // produced the results currently on screen.
  const [format, setFormat] = useState<SpecFormat>("division46");
  const [activeFormat, setActiveFormat] = useState<SpecFormat>("division46");
  // Full extracted pages, cached so a format change re-runs Pass 2 only.
  const [extractedPages, setExtractedPages] = useState<PageText[] | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  // Raw section-number input for the custom search, and the value that
  // produced the current results.
  const [sections, setSections] = useState("");
  const [activeSections, setActiveSections] = useState("");

  const handleFile = async (file: File) => {
    setStatus("loading");
    setFileName(file.name);
    setErrorMsg(null);
    setExtractedPages(null);

    try {
      let res: Response;

      if (file.size < DIRECT_UPLOAD_LIMIT) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("format", format);
        formData.append("sections", sections);
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
          body: JSON.stringify({ blobUrl: blob.url, format, sections }),
        });
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      const usedFormat = (data.format ?? format) as SpecFormat;
      setSummary(data.summary ?? null);
      setKnownMatches(data.knownMatches ?? []);
      setAiDetected(data.aiDetected ?? []);
      setProducts(data.products ?? []);
      setExtractedPages(Array.isArray(data.pages) ? data.pages : null);
      setActiveFormat(usedFormat);
      setActiveSections(usedFormat === "custom" ? sections : "");
      setStatus("done");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setStatus("error");
    }
  };

  const reanalyze = async (
    nextFormat: SpecFormat,
    pages: PageText[],
    sectionsArg = ""
  ) => {
    setReanalyzing(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, format: nextFormat, sections: sectionsArg }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Re-analysis failed. Please try again.");
      }
      setKnownMatches(data.knownMatches ?? []);
      setAiDetected(data.aiDetected ?? []);
      if (Array.isArray(data.products)) setProducts(data.products);
      setActiveFormat(nextFormat);
      setActiveSections(nextFormat === "custom" ? sectionsArg : "");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Re-analysis failed. Please try again."
      );
    } finally {
      setReanalyzing(false);
    }
  };

  const handleFormatChange = (nextFormat: SpecFormat) => {
    if (nextFormat === format) return;
    setFormat(nextFormat);
    // Re-run Pass 2 in place if we already have results + cached pages. Custom
    // waits for the user to enter section numbers and press Search.
    if (status === "done" && extractedPages) {
      if (nextFormat === "custom") {
        if (sections.trim()) void reanalyze(nextFormat, extractedPages, sections);
      } else {
        void reanalyze(nextFormat, extractedPages);
      }
    }
  };

  const handleCustomSearch = () => {
    if (!sections.trim() || status === "loading" || reanalyzing) return;
    if (format !== "custom") setFormat("custom");
    if (status === "done" && extractedPages) {
      void reanalyze("custom", extractedPages, sections);
    }
  };

  const selectorDisabled = status === "loading" || reanalyzing;

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

          <div className="mt-10 flex flex-col items-center gap-4">
            <SpecFormatSelector
              value={format}
              onChange={handleFormatChange}
              disabled={selectorDisabled}
            />
            {format === "custom" && (
              <div className="flex w-full max-w-md items-center gap-2">
                <input
                  type="text"
                  value={sections}
                  onChange={(e) => setSections(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomSearch();
                  }}
                  placeholder="Section numbers, e.g. 46, 43, 11"
                  aria-label="Section numbers to search"
                  className="w-full rounded-lg border border-light-blue bg-white px-4 py-2.5 text-sm text-navy outline-none placeholder:text-secondary focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={handleCustomSearch}
                  disabled={selectorDisabled || !sections.trim()}
                  className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Search
                </button>
              </div>
            )}
          </div>

          <div className="mt-8">
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
        products={products}
        errorMsg={errorMsg}
        activeFormat={activeFormat}
        activeSections={activeSections}
        reanalyzing={reanalyzing}
        pendingFormat={format}
        pendingSections={sections}
      />

      <WaveDivider className="bg-surface" />

      <FeedbackSection />

      <WaveDivider className="bg-white" />
    </>
  );
}
