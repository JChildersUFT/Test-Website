import type { jsPDF } from "jspdf";
import type { autoTable as AutoTableFn } from "jspdf-autotable";
import type { AiDetected, KnownMatch, ProjectSummary } from "@/lib/types";

// UFT brand palette, as [r, g, b] tuples for jsPDF.
const BLUE: [number, number, number] = [21, 101, 192]; // #1565C0
const TEAL: [number, number, number] = [15, 157, 140]; // #0F9D8C
const NAVY: [number, number, number] = [14, 42, 71]; // #0E2A47
const MUTED: [number, number, number] = [91, 107, 122]; // #5B6B7A
const WHITE: [number, number, number] = [255, 255, 255];

const MARGIN = 40;

// jsPDF augments the document with `lastAutoTable` after each autoTable call,
// but its types declare the document as `any`, so we read finalY through a
// narrow local type instead of sprinkling `any` around.
type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function formatPages(pages: number[]): string {
  return pages && pages.length > 0 ? pages.join(", ") : "—";
}

const SUMMARY_FIELDS: { key: keyof ProjectSummary; label: string }[] = [
  { key: "projectName", label: "Project Name" },
  { key: "projectNumber", label: "Project Number" },
  { key: "location", label: "Location" },
  { key: "owner", label: "Owner" },
  { key: "engineer", label: "Engineer" },
  { key: "bidDate", label: "Bid Date" },
  { key: "scopeOfWork", label: "Scope of Work" },
];

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function resultsPdfFilename(summary: ProjectSummary | null): string {
  const base =
    summary &&
    summary.projectNumber &&
    summary.projectNumber !== "Not found"
      ? slugify(summary.projectNumber)
      : summary &&
        summary.projectName &&
        summary.projectName !== "Not found"
      ? slugify(summary.projectName)
      : "";
  return base
    ? `UFT-Spec-Finder-${base}.pdf`
    : "UFT-Spec-Finder-Results.pdf";
}

export async function generateResultsPdf(params: {
  summary: ProjectSummary | null;
  knownMatches: KnownMatch[];
  aiDetected: AiDetected[];
}): Promise<void> {
  const { summary, knownMatches, aiDetected } = params;

  // Loaded on demand so jsPDF stays out of the initial page bundle.
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "pt", format: "a4" }) as AutoTableDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  // Header band
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setFillColor(...TEAL);
  doc.rect(0, 70, pageWidth, 4, "F");

  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("UFT Spec Finder", MARGIN, 35);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Spec sheet analysis results", MARGIN, 54);

  let cursorY = 100;

  // Project summary
  if (summary) {
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Project Summary", MARGIN, cursorY);
    cursorY += 8;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: contentWidth,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, textColor: NAVY, lineColor: [227, 242, 253] },
      columnStyles: {
        0: { cellWidth: 130, fontStyle: "bold", textColor: MUTED },
        1: { cellWidth: contentWidth - 130 },
      },
      body: SUMMARY_FIELDS.map(({ key, label }) => [label, summary[key] ?? "Not found"]),
    });

    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 26;
  }

  cursorY = renderCompanyTable(doc, autoTable, {
    title: "Known Partner Matches",
    headColor: BLUE,
    companies: knownMatches,
    emptyText: "No known partners were found in this document.",
    startY: cursorY,
    contentWidth,
  });

  cursorY += 26;

  renderCompanyTable(doc, autoTable, {
    title: "AI-Detected Companies",
    headColor: TEAL,
    companies: aiDetected,
    emptyText: "No additional companies were detected.",
    startY: cursorY,
    contentWidth,
  });

  // Footer note on every page
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(227, 242, 253);
    doc.line(MARGIN, pageHeight - 36, pageWidth - MARGIN, pageHeight - 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      "Analyzed by UFT Spec Finder — United Flow Technologies",
      pageWidth / 2,
      pageHeight - 22,
      { align: "center" }
    );
  }

  doc.save(resultsPdfFilename(summary));
}

function renderCompanyTable(
  doc: AutoTableDoc,
  autoTable: typeof AutoTableFn,
  opts: {
    title: string;
    headColor: [number, number, number];
    companies: (KnownMatch | AiDetected)[];
    emptyText: string;
    startY: number;
    contentWidth: number;
  }
): number {
  const { title, headColor, companies, emptyText, startY, contentWidth } = opts;

  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, MARGIN, startY);
  const tableY = startY + 8;

  if (companies.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(emptyText, MARGIN, tableY + 12);
    return tableY + 18;
  }

  autoTable(doc, {
    startY: tableY,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: contentWidth,
    theme: "grid",
    headStyles: { fillColor: headColor, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5, textColor: NAVY, lineColor: [227, 242, 253], overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 110, fontStyle: "bold" },
      1: { cellWidth: 120 },
      3: { cellWidth: 50 },
    },
    head: [["Company", "Spec Section", "Product / Application", "Pages"]],
    body: companies.map((c) => [
      c.company,
      c.specSection ?? "—",
      c.products ?? "—",
      formatPages(c.pages),
    ]),
  });

  return doc.lastAutoTable?.finalY ?? tableY;
}
