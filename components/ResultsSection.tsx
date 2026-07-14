import CompanyCard from "./CompanyCard";
import SummaryCard from "./SummaryCard";
import DownloadResultsButton from "./DownloadResultsButton";
import {
  SPEC_FORMAT_LABELS,
  type AiDetected,
  type KnownMatch,
  type ProductMatch,
  type ProjectSummary,
  type SpecFormat,
} from "@/lib/types";

type Status = "idle" | "loading" | "error" | "done";

type Props = {
  status: Status;
  summary: ProjectSummary | null;
  knownMatches: KnownMatch[];
  aiDetected: AiDetected[];
  products: ProductMatch[];
  errorMsg: string | null;
  activeFormat: SpecFormat;
  reanalyzing: boolean;
  pendingFormat: SpecFormat;
};

export default function ResultsSection({
  status,
  summary,
  knownMatches,
  aiDetected,
  products,
  errorMsg,
  activeFormat,
  reanalyzing,
  pendingFormat,
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
            {reanalyzing && (
              <p
                className="rounded-lg bg-light-teal px-4 py-3 text-center text-sm font-medium text-teal"
                role="status"
              >
                Re-analyzing with {SPEC_FORMAT_LABELS[pendingFormat]}…
              </p>
            )}

            {!reanalyzing && errorMsg && (
              <p
                className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-600"
                role="status"
              >
                {errorMsg}
              </p>
            )}

            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-secondary">
                Analysis complete. Download a copy for your records.
              </p>
              <DownloadResultsButton
                summary={summary}
                knownMatches={knownMatches}
                aiDetected={aiDetected}
                products={products}
              />
            </div>

            {summary && <SummaryCard summary={summary} />}

            <p className="-mt-6 text-xs text-secondary">
              Analyzed using: {SPEC_FORMAT_LABELS[activeFormat]}
            </p>

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
                      specSection={m.specSection}
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
                      specSection={m.specSection}
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

            <div className="rounded-2xl bg-[#F5F3FF] p-6 sm:p-8">
              <h2 className="mb-1 text-lg font-semibold text-navy">
                Product Mentions{" "}
                <span className="text-[#6366F1]">
                  ({products.length} found)
                </span>
              </h2>
              <p className="mb-4 text-sm text-secondary">
                Products and equipment types found anywhere in this document.
              </p>
              {products.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((m) => (
                    <CompanyCard
                      key={m.product}
                      company={m.product}
                      pages={m.pages}
                      variant="product"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary">
                  No tracked product types were found in this document.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
