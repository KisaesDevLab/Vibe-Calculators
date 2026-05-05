import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { fmtMoney } from "./format.js";

/**
 * Phase 13.2 / 8.6 — Reg Z Truth-in-Lending disclosure PDF.
 *
 * Single-page disclosure mirroring the Federal Reserve Form H-2
 * "Statement of Loan Cost" layout: APR, Finance Charge, Amount
 * Financed, Total of Payments in a 4-cell grid, followed by the
 * payment-schedule summary and the standard prepayment / late-fee /
 * security-interest / assumption disclosures.
 *
 * Numbers come from the Phase 8 Reg Z calc-engine output. The PDF
 * does not redo any math — it transcribes the engine's structured
 * disclosure object.
 */

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#666666", marginBottom: 16 },
  grid: { flexDirection: "row", marginBottom: 16 },
  gridCell: {
    flex: 1,
    padding: 10,
    border: "1pt solid #0f172a",
    marginRight: 8,
  },
  gridLabel: { fontSize: 8, fontWeight: 700, marginBottom: 6 },
  gridValue: { fontSize: 16, fontWeight: 700 },
  gridUnit: { fontSize: 8, color: "#666666", marginTop: 4 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  paragraph: { fontSize: 9, lineHeight: 1.5, marginBottom: 6 },
  table: { borderTop: "0.5pt solid #cccccc" },
  tableRow: { flexDirection: "row", borderBottom: "0.5pt solid #cccccc", paddingVertical: 3 },
  tableHeader: { flexDirection: "row", fontWeight: 700, paddingVertical: 4 },
  cellLeft: { flex: 2, paddingHorizontal: 4 },
  cellRight: { flex: 1, paddingHorizontal: 4, textAlign: "right" },
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

export interface RegZPdfOptions {
  /** APR % expressed as a decimal (e.g. 0.0699 for 6.99%). */
  aprPct: number;
  /** Total finance charge in dollars. */
  financeCharge: number;
  /** Amount financed (principal — prepaid fees not financed). */
  amountFinanced: number;
  /** Total of payments over the life of the loan. */
  totalOfPayments: number;
  /** Payment schedule summary — bands of equal-payment groups. */
  paymentSchedule: { count: number; amount: number; firstDue: string }[];
  /** "yes/no/conditional" for prepayment penalty. */
  prepaymentPenalty?: "yes" | "no" | "conditional";
  /** Late-fee description string. */
  lateFee?: string;
  /** Security interest taken (e.g. "the property being purchased"). */
  securityInterest?: string;
  /** Whether the obligation is assumable. */
  assumability?: "yes" | "no" | "conditional";
  borrowerName?: string;
  lenderName?: string;
  loanIdentifier?: string;
  preparedOn?: Date;
  firmName?: string;
  firmFooter?: string;
  watermark?: string;
}

export function RegZDocument({ opts }: { opts: RegZPdfOptions }): React.ReactElement {
  const preparedOn = opts.preparedOn ?? new Date();
  return (
    <Document
      title={`Truth-in-Lending Disclosure — ${opts.loanIdentifier ?? ""}`}
      author={opts.firmName ?? "Vibe Calculators"}
    >
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Federal Truth-in-Lending Disclosure</Text>
        <Text style={styles.subtitle}>
          {opts.lenderName ? `Creditor: ${opts.lenderName}  ·  ` : ""}
          {opts.borrowerName ? `Borrower: ${opts.borrowerName}` : ""}
          {opts.loanIdentifier ? `  ·  Loan ID: ${opts.loanIdentifier}` : ""}
        </Text>

        <View style={styles.grid}>
          <View style={styles.gridCell}>
            <Text style={styles.gridLabel}>ANNUAL PERCENTAGE RATE</Text>
            <Text style={styles.gridValue}>{(opts.aprPct * 100).toFixed(3)}%</Text>
            <Text style={styles.gridUnit}>The cost of your credit as a yearly rate.</Text>
          </View>
          <View style={styles.gridCell}>
            <Text style={styles.gridLabel}>FINANCE CHARGE</Text>
            <Text style={styles.gridValue}>${fmtMoney(opts.financeCharge)}</Text>
            <Text style={styles.gridUnit}>The dollar amount the credit will cost you.</Text>
          </View>
          <View style={styles.gridCell}>
            <Text style={styles.gridLabel}>AMOUNT FINANCED</Text>
            <Text style={styles.gridValue}>${fmtMoney(opts.amountFinanced)}</Text>
            <Text style={styles.gridUnit}>
              The amount of credit provided to you on your behalf.
            </Text>
          </View>
          <View style={[styles.gridCell, { marginRight: 0 }]}>
            <Text style={styles.gridLabel}>TOTAL OF PAYMENTS</Text>
            <Text style={styles.gridValue}>${fmtMoney(opts.totalOfPayments)}</Text>
            <Text style={styles.gridUnit}>
              What you will have paid after all scheduled payments.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment schedule</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.cellLeft}>Number of payments</Text>
              <Text style={styles.cellRight}>Amount</Text>
              <Text style={styles.cellRight}>First due</Text>
            </View>
            {opts.paymentSchedule.map((p, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.cellLeft}>{p.count}</Text>
                <Text style={styles.cellRight}>${fmtMoney(p.amount)}</Text>
                <Text style={styles.cellRight}>{p.firstDue}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Required disclosures</Text>
          {opts.prepaymentPenalty && (
            <Text style={styles.paragraph}>
              <Text style={{ fontWeight: 700 }}>Prepayment: </Text>
              {opts.prepaymentPenalty === "no"
                ? "If you pay off this loan early, you will not have to pay a penalty."
                : opts.prepaymentPenalty === "yes"
                  ? "If you pay off this loan early, you may have to pay a penalty."
                  : "If you pay off this loan early, you may have to pay a penalty under certain conditions."}
            </Text>
          )}
          {opts.lateFee && (
            <Text style={styles.paragraph}>
              <Text style={{ fontWeight: 700 }}>Late charge: </Text>
              {opts.lateFee}
            </Text>
          )}
          {opts.securityInterest && (
            <Text style={styles.paragraph}>
              <Text style={{ fontWeight: 700 }}>Security: </Text>
              You are giving a security interest in {opts.securityInterest}.
            </Text>
          )}
          {opts.assumability && (
            <Text style={styles.paragraph}>
              <Text style={{ fontWeight: 700 }}>Assumability: </Text>
              {opts.assumability === "yes"
                ? "Someone buying your property may assume the remainder of the loan on its original terms."
                : opts.assumability === "no"
                  ? "Someone buying your property cannot assume the remainder of the loan on its original terms."
                  : "Someone buying your property may, subject to conditions, assume the remainder of the loan."}
            </Text>
          )}
          <Text style={styles.paragraph}>
            <Text style={{ fontWeight: 700 }}>Note: </Text>
            See your contract documents for any additional information about non-payment, default,
            any required repayment in full before the scheduled date, and prepayment refunds and
            penalties.
          </Text>
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
          {opts.firmFooter ?? `Generated by ${opts.firmName ?? "Vibe Calculators"}`} · prepared{" "}
          {preparedOn.toISOString().slice(0, 10)}
        </Text>
      </Page>
    </Document>
  );
}

export async function regZToPdf(opts: RegZPdfOptions): Promise<Buffer> {
  const stream = pdf(<RegZDocument opts={opts} />);
  const blob = await stream.toBlob();
  const arrayBuf = await blob.arrayBuffer();
  return Buffer.from(arrayBuf);
}
