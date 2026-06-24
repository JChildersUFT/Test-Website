import type { ProjectSummary } from "@/lib/types";

type Props = {
  summary: ProjectSummary;
};

const FIELDS: { key: keyof ProjectSummary; label: string }[] = [
  { key: "projectName", label: "Project Name" },
  { key: "projectNumber", label: "Project Number" },
  { key: "location", label: "Location" },
  { key: "owner", label: "Owner" },
  { key: "engineer", label: "Engineer" },
  { key: "bidDate", label: "Bid Date" },
  { key: "scopeOfWork", label: "Scope of Work" },
];

export default function SummaryCard({ summary }: Props) {
  return (
    <div className="rounded-xl border border-light-blue bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-navy">Project Summary</h2>
      <dl className="flex flex-col gap-3">
        {FIELDS.map(({ key, label }) => (
          <div
            key={key}
            className="flex flex-col gap-0.5 border-b border-light-blue pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:gap-4"
          >
            <dt className="w-40 shrink-0 text-sm font-medium text-secondary">
              {label}
            </dt>
            <dd className="text-sm text-navy">{summary[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
