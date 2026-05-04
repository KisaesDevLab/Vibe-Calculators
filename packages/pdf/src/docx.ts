import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
} from "docx";
import type { ScheduleResult } from "@vibe-calc/calc-engine";

/**
 * Phase 13.6 — DOCX export via the `docx` library.
 *
 * Memo-style output (the build plan §13.6 calls this out as the
 * intended use case). The current template is a single page with:
 *   - Firm header (operator-supplied)
 *   - Calculation label
 *   - Summary stats paragraph
 *   - Schedule table (capped at 60 rows; long schedules fall back
 *     to a 'see attached XLSX' note)
 *
 * Bookmarks for editable narrative sections (Phase 18+ tax memos)
 * land when the corresponding tax calculators land.
 */

export interface DocxOptions {
  calculationLabel?: string;
  firmName?: string;
  preparedBy?: string;
  preparedOn?: Date;
  /** Free-text narrative body inserted before the schedule table. */
  narrative?: string;
}

const SUMMARY_TABLE_ROW_LIMIT = 60;

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

export async function scheduleToDocx(
  schedule: ScheduleResult,
  opts: DocxOptions = {},
): Promise<Buffer> {
  const preparedOn = opts.preparedOn ?? new Date();

  const headerParagraphs: Paragraph[] = [];
  if (opts.firmName) {
    headerParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: opts.firmName, bold: true, size: 24 })],
        alignment: AlignmentType.LEFT,
      }),
    );
  }
  headerParagraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: opts.calculationLabel ?? "Amortization schedule" })],
    }),
  );
  headerParagraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Prepared by ${opts.preparedBy ?? "—"}  ·  ${preparedOn.toISOString().slice(0, 10)}`,
          size: 18,
          color: "666666",
        }),
      ],
    }),
  );

  const summaryParagraph = new Paragraph({
    children: [
      new TextRun({
        text: `Ending balance: ${schedule.endingBalance.toFixed(2)}    Total interest: ${schedule.totalInterest.toFixed(2)}    Total principal: ${schedule.totalPrincipal.toFixed(2)}${schedule.hasNegativeAm ? "    ⚠ Negative amortization" : ""}`,
      }),
    ],
  });

  const narrative = opts.narrative
    ? [
        new Paragraph({ text: "" }),
        new Paragraph({
          children: [new TextRun({ text: opts.narrative })],
        }),
      ]
    : [];

  const headerCell = (text: string): TableCell =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
    });

  const dataCell = (text: string): TableCell =>
    new TableCell({
      children: [new Paragraph({ text })],
    });

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("Date"),
        headerCell("Event"),
        headerCell("Opening"),
        headerCell("Interest"),
        headerCell("Payment"),
        headerCell("Principal"),
        headerCell("Closing"),
      ],
    }),
  ];

  const visible = schedule.rows.slice(0, SUMMARY_TABLE_ROW_LIMIT);
  for (const r of visible) {
    tableRows.push(
      new TableRow({
        children: [
          dataCell(r.date.toISOString().slice(0, 10)),
          dataCell(r.kind),
          dataCell(r.opening.toFixed(2)),
          dataCell(r.interestAccrued.toFixed(2)),
          dataCell(r.paymentApplied.toFixed(2)),
          dataCell(r.principalApplied.toFixed(2)),
          dataCell(r.closing.toFixed(2)),
        ],
      }),
    );
  }

  const table = new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });

  const truncationNote: Paragraph[] = [];
  if (schedule.rows.length > SUMMARY_TABLE_ROW_LIMIT) {
    truncationNote.push(
      new Paragraph({ text: "" }),
      new Paragraph({
        children: [
          new TextRun({
            text: `… ${schedule.rows.length - SUMMARY_TABLE_ROW_LIMIT} additional rows truncated. See attached XLSX for the full schedule.`,
            italics: true,
            color: "666666",
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    creator: opts.firmName ?? "Vibe Calculators",
    title: opts.calculationLabel ?? "Amortization schedule",
    sections: [
      {
        children: [
          ...headerParagraphs,
          new Paragraph({ text: "" }),
          summaryParagraph,
          ...narrative,
          new Paragraph({ text: "" }),
          table,
          ...truncationNote,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

void noBorder;
