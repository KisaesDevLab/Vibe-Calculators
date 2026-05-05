import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { fmtMoney } from "./format.js";

/**
 * Phase 13.2 — IRR / NPV summary PDF.
 *
 * Single-page summary of an IRR/NPV calculation: the cash-flow
 * series in tabular form, computed IRR / NPV / payback period in
 * the header strip, and an optional sensitivity table.
 */

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  subtle: { fontSize: 9, color: "#666666", marginBottom: 12 },
  summaryRow: { flexDirection: "row", marginBottom: 12 },
  summaryCell: {
    flex: 1,
    padding: 8,
    border: "1pt solid #e5e7eb",
    marginRight: 6,
    borderRadius: 4,
  },
  summaryLabel: { fontSize: 8, color: "#666666" },
  summaryValue: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  table: { marginTop: 8 },
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
  cellDate: { width: "20%", paddingHorizontal: 4 },
  cellNum: { width: "20%", paddingHorizontal: 4, textAlign: "right" },
  cellMemo: { flex: 1, paddingHorizontal: 4 },
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

export interface IrrNpvPdfOptions {
  title?: string;
  flows: { date: string; amount: number; memo?: string }[];
  irrPct?: number | null;
  npv?: number;
  paybackYears?: number | null;
  /** Discount rate used for NPV. */
  discountRatePct?: number;
  /** Sensitivity sweeps: [discountRatePct, npvAtThatRate]. */
  sensitivity?: { ratePct: number; npv: number }[];
  preparedBy?: string;
  preparedOn?: Date;
  firmName?: string;
  firmFooter?: string;
  watermark?: string;
}

export function IrrNpvDocument({ opts }: { opts: IrrNpvPdfOptions }): React.ReactElement {
  const preparedOn = opts.preparedOn ?? new Date();
  let runningBalance = 0;
  return (
    <Document
      title={opts.title ?? "IRR / NPV summary"}
      author={opts.firmName ?? "Vibe Calculators"}
    >
      <Page size="LETTER" style={styles.page}>
        {opts.firmName && <Text style={styles.subtle}>{opts.firmName}</Text>}
        <Text style={styles.title}>{opts.title ?? "IRR / NPV summary"}</Text>
        <Text style={styles.subtle}>
          Prepared by {opts.preparedBy ?? "—"} · {preparedOn.toISOString().slice(0, 10)}
        </Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>IRR</Text>
            <Text style={styles.summaryValue}>
              {opts.irrPct !== null && opts.irrPct !== undefined
                ? `${(opts.irrPct * 100).toFixed(3)}%`
                : "n/a"}
            </Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>
              NPV{" "}
              {opts.discountRatePct !== undefined
                ? `at ${(opts.discountRatePct * 100).toFixed(2)}%`
                : ""}
            </Text>
            <Text style={styles.summaryValue}>
              ${opts.npv !== undefined ? fmtMoney(opts.npv) : "—"}
            </Text>
          </View>
          <View style={[styles.summaryCell, { marginRight: 0 }]}>
            <Text style={styles.summaryLabel}>Payback</Text>
            <Text style={styles.summaryValue}>
              {opts.paybackYears !== null && opts.paybackYears !== undefined
                ? `${opts.paybackYears.toFixed(2)} yr`
                : "—"}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellDate}>Date</Text>
            <Text style={styles.cellNum}>Cash flow</Text>
            <Text style={styles.cellNum}>Cumulative</Text>
            <Text style={styles.cellMemo}>Memo</Text>
          </View>
          {opts.flows.map((f, i) => {
            runningBalance += f.amount;
            return (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.cellDate}>{f.date}</Text>
                <Text style={styles.cellNum}>{fmtMoney(f.amount)}</Text>
                <Text style={styles.cellNum}>{fmtMoney(runningBalance)}</Text>
                <Text style={styles.cellMemo}>{f.memo ?? ""}</Text>
              </View>
            );
          })}
        </View>

        {opts.sensitivity && opts.sensitivity.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Text style={{ fontWeight: 700, marginBottom: 4 }}>NPV sensitivity</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.cellNum}>Discount rate</Text>
              <Text style={styles.cellNum}>NPV</Text>
            </View>
            {opts.sensitivity.map((s, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.cellNum}>{(s.ratePct * 100).toFixed(2)}%</Text>
                <Text style={styles.cellNum}>${fmtMoney(s.npv)}</Text>
              </View>
            ))}
          </View>
        )}

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
          {opts.firmFooter ?? `Generated by ${opts.firmName ?? "Vibe Calculators"}`} · page rendered{" "}
          {preparedOn.toISOString().slice(0, 10)}
        </Text>
      </Page>
    </Document>
  );
}

export async function irrNpvToPdf(opts: IrrNpvPdfOptions): Promise<Buffer> {
  const stream = pdf(<IrrNpvDocument opts={opts} />);
  const blob = await stream.toBlob();
  const arrayBuf = await blob.arrayBuffer();
  return Buffer.from(arrayBuf);
}
