"use client";

import type { SpecFormat } from "@/lib/types";

type Props = {
  value: SpecFormat;
  onChange: (format: SpecFormat) => void;
  disabled?: boolean;
};

const OPTIONS: { value: SpecFormat; label: string; description: string }[] = [
  {
    value: "division46",
    label: "Division 46",
    description:
      "New MasterFormat (post-2004) — wastewater/water treatment sections numbered 46 xxxx (and related Division 43).",
  },
  {
    value: "legacy",
    label: "Division 11/13/15",
    description:
      "Legacy MasterFormat (pre-2004) — equipment sections numbered 11xxx, 13xxx, 15xxx, 17xxx.",
  },
  {
    value: "keyword",
    label: "Keyword scan",
    description:
      "No division structure — scan the full document for process-equipment keywords.",
  },
  {
    value: "full",
    label: "Full document",
    description:
      "Send everything to Claude (use for short specs or an unknown format).",
  },
];

export default function SpecFormatSelector({ value, onChange, disabled }: Props) {
  const active = OPTIONS.find((o) => o.value === value);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-navy">Spec Format</p>
      <div
        role="group"
        aria-label="Spec Format"
        className="inline-flex flex-wrap gap-1 rounded-lg bg-surface p-1"
      >
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "bg-primary text-white shadow-sm"
                  : "text-secondary hover:bg-white hover:text-navy"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {active && (
        <p className="mt-2 text-xs text-secondary">{active.description}</p>
      )}
    </div>
  );
}
