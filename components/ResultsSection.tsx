import CompanyCard from "./CompanyCard";
import SummaryCard from "./SummaryCard";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

type Props = {
  status: Status;
  summary: ProjectSummary | null;
  knownMatches: KnownMatch[];
  aiDetected: AiDetected[];
  errorMsg: string | null;
};

export default function ResultsSection({
  status,
  summary,
  knownMatches,
  aiDetected,
  errorMsg,
}: Props) {
  return (
    <section className="w-full bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-16">
        {status === "idle" && (
          <p className="text-center text-sm text-secondary">
            Upload a spec sheet PDF above to see every company it mentions.
          </p>
        )}

        {status === "loading" && (
          <p className="text-center text-sm text-secondary">
            Reading the document and checking for companies…
          </p>
        )}

        {status === "error" && (
          <p className="text-center text-sm font-medium text-red-600">
            {errorMsg ?? "Something went wrong. Please try again."}
          </p>
        )}

        {status === "done" && (
          <div className="flex flex-col gap-10">
            {summary && <SummaryCard summary={summary} />}

            <div>
              <h2 className="mb-1 text-lg font-semibold text-navy">
                Known partner matches
              </h2>
              <p className="mb-4 text-sm text-secondary">
                Companies from your known-partner list found in this document.
              </p>
              {knownMatches.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {knownMatches.map((m) => (
                    <CompanyCard
                      key={m.company}
                      company={m.company}
                      pages={m.pages}
                      products={m.products}
                      variant="known"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary">
                  No known partners were found in this document.
                </p>
              )}
            </div>

            <div>
              <h2 className="mb-1 text-lg font-semibold text-navy">
                Other companies detected
              </h2>
              <p className="mb-4 text-sm text-secondary">
                Companies the AI found in the document that aren&apos;t on your
                known-partner list.
              </p>
              {aiDetected.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {aiDetected.map((m) => (
                    <CompanyCard
                      key={m.company}
                      company={m.company}
                      pages={m.pages}
                      products={m.products}
                      variant="ai"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary">
                  No additional companies were detected.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
