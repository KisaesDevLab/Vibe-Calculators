import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

/**
 * Phase 13 — generic tax/TVM calculator memo PDF.
 *
 * Renders a one- or two-page memo: heading, inputs, key outputs,
 * narrative paragraph, references. Used for every calculator that
 * doesn't have a custom PDF template (i.e. all 22 tax calculators
 * + 7 TVM templates that aren't full amortization schedules).
 *
 * Visual treatment is intentionally plain so it composes well with
 * any firm-branded letterhead the operator overlays in their email
 * client. Phase 25 wires the firm-branding header.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  firmHeader: { fontSize: 9, color: "#475569", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#475569", marginBottom: 16 },

  sectionTitle: {
    fontSize: 9,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
  },

  kvRow: { flexDirection: "row", paddingVertical: 2 },
  kvKey: { width: "45%", color: "#475569" },
  kvVal: { width: "55%", fontWeight: 700 },

  narrative: { lineHeight: 1.5, marginTop: 6 },

  refs: { fontSize: 9, color: "#64748b", marginTop: 12 },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#94a3b8",
    textAlign: "center",
  },
});

export interface CalculatorMemoInput {
  /** Calculator kind, e.g. "tax.rmd". */
  kind: string;
  /** Display name (calculator's metadata.name). */
  name: string;
  description?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  narrative: string;
  formReferences?: string[];
  /** Set by the API caller — the user / firm context for the header. */
  preparedBy?: string;
  preparedOn?: Date;
  firmName?: string;
  firmFooter?: string;
  /** Optional watermark; e.g. "DRAFT — Not for Distribution". */
  watermark?: string;
  /** Phase 21.7 — signed-PDF approver name (rendered in footer). */
  approverName?: string;
  /** Phase 21.7 — SHA-256 of canonical inputs+outputs (rendered in footer). */
  contentHash?: string;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    if (Math.abs(v) >= 1000) {
      return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
    }
    return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function humanLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export function CalculatorMemoDocument({ input }: { input: CalculatorMemoInput }): JSX.Element {
  const inputEntries = Object.entries(input.inputs).filter(([, v]) => v !== undefined);
  const outputEntries = Object.entries(input.outputs).filter(([, v]) => v !== undefined);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {input.firmName && <Text style={styles.firmHeader}>{input.firmName}</Text>}
        <Text style={styles.title}>{input.name}</Text>
        <Text style={styles.subtitle}>
          {input.preparedBy ? `Prepared by ${input.preparedBy} · ` : ""}
          {(input.preparedOn ?? new Date()).toLocaleDateString("en-US")}
        </Text>

        <Text style={styles.sectionTitle}>Inputs</Text>
        <View>
          {inputEntries.map(([k, v]) => (
            <View key={k} style={styles.kvRow}>
              <Text style={styles.kvKey}>{humanLabel(k)}</Text>
              <Text style={styles.kvVal}>{formatValue(v)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Result</Text>
        <View>
          {outputEntries.map(([k, v]) => (
            <View key={k} style={styles.kvRow}>
              <Text style={styles.kvKey}>{humanLabel(k)}</Text>
              <Text style={styles.kvVal}>{formatValue(v)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Narrative</Text>
        <Text style={styles.narrative}>{input.narrative}</Text>

        {input.formReferences && input.formReferences.length > 0 && (
          <Text style={styles.refs}>References: {input.formReferences.join(" · ")}</Text>
        )}

        {input.watermark && (
          <Text
            style={{
              position: "absolute",
              top: "45%",
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 60,
              color: "#fee2e2",
              opacity: 0.4,
            }}
            fixed
          >
            {input.watermark}
          </Text>
        )}

        <Text style={styles.footer} fixed>
          {input.firmFooter ?? "Computed by Vibe Calculators"} · {input.kind}
          {input.approverName ? ` · Approved by ${input.approverName}` : ""}
          {input.contentHash ? ` · sha256:${input.contentHash.slice(0, 12)}…` : ""}
        </Text>
      </Page>
    </Document>
  );
}

export async function calculatorMemoToPdf(input: CalculatorMemoInput): Promise<Buffer> {
  const stream = pdf(<CalculatorMemoDocument input={input} />);
  const blob = await stream.toBlob();
  const arrayBuf = await blob.arrayBuffer();
  return Buffer.from(arrayBuf);
}
