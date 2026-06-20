"use client";

import { useState } from "react";
import UploadZone from "./UploadZone";
import WaveDivider from "./WaveDivider";
import ResultsSection from "./ResultsSection";

type Status = "idle" | "loading" | "error" | "done";

export default function SpecFinderApp() {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [knownMatches, setKnownMatches] = useState<string[]>([]);
  const [aiDetected, setAiDetected] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setStatus("loading");
    setFileName(file.name);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

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
        knownMatches={knownMatches}
        aiDetected={aiDetected}
        errorMsg={errorMsg}
      />
    </>
  );
}
