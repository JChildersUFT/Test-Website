"use client";

import { useState } from "react";
import { generateResultsPdf } from "@/lib/resultsPdf";
import type {
  AiDetected,
  KnownMatch,
  ProductMatch,
  ProjectSummary,
} from "@/lib/types";

type Props = {
  summary: ProjectSummary | null;
  knownMatches: KnownMatch[];
  aiDetected: AiDetected[];
  products: ProductMatch[];
};

export default function DownloadResultsButton({
  summary,
  knownMatches,
  aiDetected,
  products,
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);

  const handleDownload = async () => {
    if (generating) return;
    setGenerating(true);
    setError(false);
    try {
      await generateResultsPdf({ summary, knownMatches, aiDetected, products });
    } catch {
      setError(true);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={generating}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 2.5v9m0 0 3.5-3.5M10 11.5 6.5 8M3.5 14v1.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {generating ? "Preparing PDF…" : "Download PDF"}
      </button>
      {error && (
        <p className="text-xs font-medium text-red-600" role="status">
          Could not generate the PDF. Please try again.
        </p>
      )}
    </div>
  );
}
