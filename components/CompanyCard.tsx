type Props = {
  company: string;
  pages: number[];
  specSection?: string;
  products?: string;
  variant: "known" | "ai";
};

function formatSpecSection(section: string) {
  const trimmed = section.trim();
  if (/^section\s+/i.test(trimmed)) {
    return `§${trimmed.replace(/^section\s+/i, "")}`;
  }
  return trimmed.startsWith("§") ? trimmed : `§${trimmed}`;
}

export default function CompanyCard({
  company,
  pages,
  specSection,
  products,
  variant,
}: Props) {
  const isKnown = variant === "known";

  return (
    <div
      className={
        isKnown
          ? "rounded-xl border border-teal/30 bg-teal/10 p-4"
          : "rounded-xl border border-primary/30 bg-light-blue p-4"
      }
    >
      <div className="flex items-start gap-1.5">
        {isKnown && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          >
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke="#0F9D8C"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span
          className={
            isKnown
              ? "text-sm font-semibold text-teal"
              : "text-sm font-semibold text-primary"
          }
        >
          {company}
        </span>
      </div>

      {pages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {pages.map((page) => (
            <span
              key={page}
              className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-secondary"
            >
              p. {page}
            </span>
          ))}
        </div>
      )}

      {specSection && (
        <p className="mt-2 text-xs text-gray-400">{formatSpecSection(specSection)}</p>
      )}

      {products && (
        <p className="mt-1 text-xs leading-snug text-secondary">{products}</p>
      )}
    </div>
  );
}
