import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

const BLUE = "#1565C0";
const TEAL = "#0F9D8C";
const NAVY = "#0E2A47";
const BORDER = "#E3F2FD";
const MUTED = "#5B6B7A";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPages(pages: number[]): string {
  if (!pages || pages.length === 0) return "—";
  return pages.join(", ");
}

const SUMMARY_FIELDS: { key: keyof ProjectSummary; label: string }[] = [
  { key: "projectName", label: "Project Name" },
  { key: "projectNumber", label: "Project Number" },
  { key: "owner", label: "Owner" },
  { key: "engineer", label: "Engineer" },
  { key: "bidDate", label: "Bid Date" },
  { key: "scopeOfWork", label: "Scope of Work" },
];

function summarySection(summary: ProjectSummary): string {
  const rows = SUMMARY_FIELDS.map(({ key, label }) => {
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${BORDER};font-size:13px;font-weight:600;color:${MUTED};width:160px;vertical-align:top;">${escapeHtml(
          label
        )}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${NAVY};">${escapeHtml(
          summary[key] ?? "Not found"
        )}</td>
      </tr>`;
  }).join("");

  return `
    <h2 style="margin:0 0 12px;font-size:16px;color:${NAVY};">Project Summary</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;margin-bottom:28px;">
      ${rows}
    </table>`;
}

function companyTable(
  title: string,
  accent: string,
  companies: (KnownMatch | AiDetected)[],
  emptyText: string
): string {
  let inner: string;

  if (companies.length === 0) {
    inner = `<p style="margin:0;font-size:13px;color:${MUTED};">${escapeHtml(
      emptyText
    )}</p>`;
  } else {
    const headerCell = (label: string) =>
      `<th align="left" style="padding:8px 12px;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#ffffff;background:${accent};font-weight:600;">${label}</th>`;

    const rows = companies
      .map((c, i) => {
        const bg = i % 2 === 0 ? "#ffffff" : "#f7faf8";
        return `
        <tr style="background:${bg};">
          <td style="padding:8px 12px;border-bottom:1px solid ${BORDER};font-size:13px;font-weight:600;color:${NAVY};vertical-align:top;">${escapeHtml(
            c.company
          )}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${NAVY};vertical-align:top;">${escapeHtml(
            c.specSection ?? "—"
          )}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${NAVY};vertical-align:top;">${escapeHtml(
            c.products ?? "—"
          )}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${BORDER};font-size:13px;color:${NAVY};vertical-align:top;white-space:nowrap;">${escapeHtml(
            formatPages(c.pages)
          )}</td>
        </tr>`;
      })
      .join("");

    inner = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
        <thead>
          <tr>
            ${headerCell("Company")}
            ${headerCell("Spec Section")}
            ${headerCell("Product / Application")}
            ${headerCell("Pages")}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return `
    <h2 style="margin:0 0 12px;font-size:16px;color:${NAVY};">${escapeHtml(
      title
    )}</h2>
    <div style="margin-bottom:28px;">${inner}</div>`;
}

export function buildResultsEmailHtml(params: {
  summary: ProjectSummary | null;
  knownMatches: KnownMatch[];
  aiDetected: AiDetected[];
}): string {
  const { summary, knownMatches, aiDetected } = params;

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#eef4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4ef;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(90deg,${BLUE},${TEAL});padding:24px 32px;">
                <h1 style="margin:0;font-size:20px;color:#ffffff;">UFT Spec Finder</h1>
                <p style="margin:4px 0 0;font-size:13px;color:#e0f7f4;">Your spec sheet analysis results</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${summary ? summarySection(summary) : ""}
                ${companyTable(
                  "Known Partner Matches",
                  BLUE,
                  knownMatches,
                  "No known partners were found in this document."
                )}
                ${companyTable(
                  "AI-Detected Companies",
                  TEAL,
                  aiDetected,
                  "No additional companies were detected."
                )}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BORDER};text-align:center;">
                <p style="margin:0;font-size:12px;color:${MUTED};">
                  Analyzed by <strong style="color:${BLUE};">UFT Spec Finder</strong> — United Flow Technologies
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
