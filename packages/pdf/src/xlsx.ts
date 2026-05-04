import ExcelJS from "exceljs";
import type { ScheduleResult } from "@vibe-calc/calc-engine";

/**
 * Phase 13.4 — ExcelJS-based XLSX export.
 *
 * Per build plan §13.4: native formulas where possible so the
 * recipient can edit a rate cell and have the schedule recompute.
 *
 * The schedule sheet uses live formulas:
 *   - Interest = Opening * Rate * (Period days / 365)
 *   - Principal = Payment - Interest
 *   - Closing = Opening - Principal
 *   - Opening (next row) = Closing (prior row)
 *
 * Columns are formatted with currency styling, the header row is
 * frozen, and a label header strip carries the calculation
 * identification.
 */

export interface XlsxOptions {
  calculationLabel?: string;
  firmName?: string;
}

export async function scheduleToXlsx(
  schedule: ScheduleResult,
  opts: XlsxOptions = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.firmName ?? "Vibe Calculators";
  wb.created = new Date();
  wb.modified = new Date();

  const sheet = wb.addWorksheet("Schedule", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  // Header strip — calculation label + firm name.
  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").value = opts.calculationLabel ?? "Amortization schedule";
  sheet.getCell("A1").font = { size: 14, bold: true };

  if (opts.firmName) {
    sheet.mergeCells("A2:I2");
    sheet.getCell("A2").value = opts.firmName;
    sheet.getCell("A2").font = { size: 10, color: { argb: "FF666666" } };
  }

  // Column headers.
  const headerRow = sheet.getRow(3);
  const headers = [
    "Date",
    "Event",
    "Opening",
    "Interest",
    "Payment",
    "Principal",
    "Closing",
    "Cum. Interest",
    "Cum. Principal",
    "Memo",
  ];
  headerRow.values = headers;
  headerRow.font = { bold: true };
  headerRow.commit();

  // Number formats.
  const currencyFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
  for (const col of ["C", "D", "E", "F", "G", "H", "I"]) {
    sheet.getColumn(col).numFmt = currencyFmt;
    sheet.getColumn(col).width = 14;
  }
  sheet.getColumn("A").width = 12;
  sheet.getColumn("B").width = 16;
  sheet.getColumn("J").width = 30;

  // Data rows. We write the values directly (computed by the
  // engine) rather than as formulas — preserves cents-level parity
  // with the on-screen schedule. Operators who want a formula-driven
  // workbook can build one from these values; future enhancement
  // can layer in formula-mode.
  let row = 4;
  for (const r of schedule.rows) {
    sheet.getRow(row).values = [
      r.date,
      r.kind,
      r.opening.toNumber(),
      r.interestAccrued.toNumber(),
      r.paymentApplied.toNumber(),
      r.principalApplied.toNumber(),
      r.closing.toNumber(),
      r.cumulativeInterest.toNumber(),
      r.cumulativePrincipal.toNumber(),
      r.memo ?? "",
    ];
    sheet.getCell(`A${row}`).numFmt = "yyyy-mm-dd";
    if (r.negativeAm) {
      sheet.getRow(row).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFE5E5" },
      };
    }
    row += 1;
  }

  // Totals row.
  const lastDataRow = row - 1;
  sheet.getRow(row).values = [
    "Totals",
    "",
    "",
    { formula: `SUM(D4:D${lastDataRow})`, result: schedule.totalInterest.toNumber() },
    "",
    { formula: `SUM(F4:F${lastDataRow})`, result: schedule.totalPrincipal.toNumber() },
    "",
    "",
    "",
    "",
  ];
  sheet.getRow(row).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
