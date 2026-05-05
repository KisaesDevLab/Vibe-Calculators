import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { ScheduleResult, ScheduleSubtotal } from "@vibe-calc/calc-engine";

/**
 * Phase 13.1 / 13.2 — PDF export.
 *
 * Implementation note: the build plan called for Puppeteer + a
 * headless-Chrome process pool. We use @react-pdf/renderer instead
 * — pure-JS PDF generation that avoids the 200 MB Chromium download
 * in the API container. The visual fidelity is lower than
 * Chrome-rendered HTML but is more than enough for the
 * Phase-13 templates (amortization schedules, Reg Z disclosures).
 * Phase 25 may upgrade to Puppeteer for pixel-perfect templates if
 * customers ask for them.
 */

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10 },
  firmHeader: { fontSize: 12, fontWeight: 700, marginBottom: 4, color: "#0f172a" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 12 },
  subtle: { fontSize: 9, color: "#666666", marginBottom: 8 },
  summaryRow: { flexDirection: "row", marginBottom: 12 },
  summaryCell: {
    flex: 1,
    padding: 6,
    border: "1pt solid #e5e7eb",
    marginRight: 6,
    borderRadius: 4,
  },
  summaryLabel: { fontSize: 8, color: "#666666" },
  summaryValue: { fontSize: 11, fontWeight: 700, marginTop: 2 },

  table: { display: "flex", flexDirection: "column", marginTop: 6 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 4,
    fontWeight: 700,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #e5e7eb",
    paddingVertical: 3,
  },
  tableRowAlt: { backgroundColor: "#fafafa" },
  tableRowNeg: { backgroundColor: "#fef2f2" },
  /**
   * Subtotal row — Phase 13.2. Rendered between the rows that close
   * out a fiscal year (or quarter / month). TValue-style: bold, no
   * Opening / Closing / Cum.Interest columns, just sum of payment /
   * interest / principal in their respective columns.
   */
  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTop: "0.5pt solid #94a3b8",
    borderBottom: "0.5pt solid #94a3b8",
    backgroundColor: "#e2e8f0",
    fontWeight: 700,
  },
  grandTotalRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderTop: "1pt solid #0f172a",
    borderBottom: "1pt solid #0f172a",
    backgroundColor: "#cbd5e1",
    fontWeight: 700,
  },
  cellDate: { width: "12%", paddingHorizontal: 4 },
  cellKind: { width: "13%", paddingHorizontal: 4 },
  cellNum: { width: "12%", paddingHorizontal: 4, textAlign: "right" },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#999999",
    textAlign: "center",
  },
});

export interface AmortizationPdfOptions {
  calculationLabel?: string;
  firmName?: string;
  firmFooter?: string;
  preparedBy?: string;
  preparedOn?: Date;
  /** Watermark text drawn diagonally across each page. */
  watermark?: string;
  /**
   * Phase 21.7 — signed-PDF metadata. When the calculation is in
   * status='approved', the export pipeline computes a SHA-256 hash
   * of the inputs+outputs JSON and passes the approver name + hash
   * here. The footer prints "Approved by X · sha256:abcd…" so the
   * recipient can verify the document content matches the audit-log
   * version.
   */
  approverName?: string;
  contentHash?: string;
  /**
   * Phase 13.2 — subtotal markers. Computed via
   * `computeSubtotals(schedule, ...)` in calc-engine; rendered inline
   * in the schedule table at the indices the marker specifies.
   * Empty/undefined = no grouping (just the flat schedule).
   */
  subtotals?: ScheduleSubtotal[];
}

function fmt(d: { toFixed(n: number): string }): string {
  return d.toFixed(2);
}

export function AmortizationDocument({
  schedule,
  opts,
}: {
  schedule: ScheduleResult;
  opts: AmortizationPdfOptions;
}): React.ReactElement {
  const preparedOn = opts.preparedOn ?? new Date();
  return (
    <Document
      title={opts.calculationLabel ?? "Amortization schedule"}
      author={opts.firmName ?? "Vibe Calculators"}
    >
      <Page size="LETTER" style={styles.page}>
        {opts.firmName && <Text style={styles.firmHeader}>{opts.firmName}</Text>}
        <Text style={styles.title}>{opts.calculationLabel ?? "Amortization schedule"}</Text>
        <Text style={styles.subtle}>
          Prepared by {opts.preparedBy ?? "—"} · {preparedOn.toISOString().slice(0, 10)}
        </Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Ending balance</Text>
            <Text style={styles.summaryValue}>{fmt(schedule.endingBalance)}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Total interest</Text>
            <Text style={styles.summaryValue}>{fmt(schedule.totalInterest)}</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Total principal</Text>
            <Text style={styles.summaryValue}>{fmt(schedule.totalPrincipal)}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellDate}>Date</Text>
            <Text style={styles.cellKind}>Event</Text>
            <Text style={styles.cellNum}>Opening</Text>
            <Text style={styles.cellNum}>Interest</Text>
            <Text style={styles.cellNum}>Payment</Text>
            <Text style={styles.cellNum}>Principal</Text>
            <Text style={styles.cellNum}>Closing</Text>
            <Text style={styles.cellNum}>Cum. Interest</Text>
          </View>
          {schedule.rows.map((r, i) => {
            const rowStyle = [
              styles.tableRow,
              ...(i % 2 === 1 ? [styles.tableRowAlt] : []),
              ...(r.negativeAm ? [styles.tableRowNeg] : []),
            ];
            // Subtotal markers tied to this row index land below it
            // (e.g. "2024 Totals" appears after the last 2024 row).
            const subtotalsAfterThisRow =
              opts.subtotals?.filter((s) => s.afterRowIndex === i) ?? [];
            return (
              <View key={i}>
                <View style={rowStyle}>
                  <Text style={styles.cellDate}>{r.date.toISOString().slice(0, 10)}</Text>
                  <Text style={styles.cellKind}>{r.kind}</Text>
                  <Text style={styles.cellNum}>{fmt(r.opening)}</Text>
                  <Text style={styles.cellNum}>{fmt(r.interestAccrued)}</Text>
                  <Text style={styles.cellNum}>{fmt(r.paymentApplied)}</Text>
                  <Text style={styles.cellNum}>{fmt(r.principalApplied)}</Text>
                  <Text style={styles.cellNum}>{fmt(r.closing)}</Text>
                  <Text style={styles.cellNum}>{fmt(r.cumulativeInterest)}</Text>
                </View>
                {subtotalsAfterThisRow.map((s, si) => (
                  <View
                    key={`sub-${i}-${si}`}
                    style={s.label === "Grand Total" ? styles.grandTotalRow : styles.subtotalRow}
                  >
                    <Text style={[styles.cellDate, { width: "25%", fontWeight: 700 }]}>
                      {s.label}
                    </Text>
                    <Text style={styles.cellNum}>{/* opening: blank */}</Text>
                    <Text style={styles.cellNum}>{fmt(s.totalInterest)}</Text>
                    <Text style={styles.cellNum}>{fmt(s.totalPayment)}</Text>
                    <Text style={styles.cellNum}>{fmt(s.totalPrincipal)}</Text>
                    <Text style={styles.cellNum}>{/* closing: blank */}</Text>
                    <Text style={styles.cellNum}>{/* cum interest: blank */}</Text>
                  </View>
                ))}
              </View>
            );
          })}
          {/* Grand total at end (afterRowIndex = lastRow but maybe also -1 for empty schedules). */}
          {opts.subtotals
            ?.filter((s) => s.afterRowIndex === -1)
            .map((s, si) => (
              <View key={`sub-end-${si}`} style={styles.grandTotalRow}>
                <Text style={[styles.cellDate, { width: "25%", fontWeight: 700 }]}>{s.label}</Text>
                <Text style={styles.cellNum} />
                <Text style={styles.cellNum}>{fmt(s.totalInterest)}</Text>
                <Text style={styles.cellNum}>{fmt(s.totalPayment)}</Text>
                <Text style={styles.cellNum}>{fmt(s.totalPrincipal)}</Text>
                <Text style={styles.cellNum} />
                <Text style={styles.cellNum} />
              </View>
            ))}
        </View>

        {opts.watermark && (
          <Text
            style={{
              position: "absolute",
              top: "45%",
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 60,
              color: "#fee2e2",
              opacity: 0.6,
              transform: "rotate(-30deg)",
            }}
            fixed
          >
            {opts.watermark}
          </Text>
        )}
        <Text style={styles.footer} fixed>
          {opts.firmFooter ?? "Generated by Vibe Calculators"} · page rendered{" "}
          {preparedOn.toISOString().slice(0, 10)}
          {opts.approverName ? ` · Approved by ${opts.approverName}` : ""}
          {opts.contentHash ? ` · sha256:${opts.contentHash.slice(0, 12)}…` : ""}
        </Text>
      </Page>
    </Document>
  );
}

/** Render an Amortization schedule to a PDF Buffer. */
export async function scheduleToPdf(
  schedule: ScheduleResult,
  opts: AmortizationPdfOptions = {},
): Promise<Buffer> {
  const stream = pdf(<AmortizationDocument schedule={schedule} opts={opts} />);
  const blob = await stream.toBlob();
  const arrayBuf = await blob.arrayBuffer();
  return Buffer.from(arrayBuf);
}
