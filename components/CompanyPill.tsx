type Props = {
  label: string;
  variant: "known" | "ai";
};

export default function CompanyPill({ label, variant }: Props) {
  const isKnown = variant === "known";

  return (
    <span
      className={
        isKnown
          ? "inline-flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal/10 px-4 py-1.5 text-sm font-medium text-teal"
          : "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-light-blue px-4 py-1.5 text-sm font-medium text-primary"
      }
    >
      {isKnown && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
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
      {label}
    </span>
  );
}
