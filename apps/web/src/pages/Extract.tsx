import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, FileSearch, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractApi, type ExtractionRow } from "@/extract/api";
import { ApiError } from "@/auth/api";

/**
 * Phase 23 — AI loan-agreement extraction UI.
 *
 * Flow:
 *   1. Operator pastes the agreement text (or relevant excerpt).
 *   2. POST /extractions creates a 'pending' job; POST /run kicks
 *      the LLM and persists the structured extraction. The job
 *      lands at status 'needs_review' regardless of confidence.
 *   3. The operator reviews the extracted fields, flags
 *      low-confidence items, and clicks "Apply to workbench" which
 *      seeds the TVM workbench with the loan amount + rate + term.
 *
 * The build plan also calls for PDF/DOCX upload → extracted text
 * preview. That's a follow-up; this MVP requires the operator to
 * paste the text. The fields the model extracts are the same.
 */

export function ExtractPage(): JSX.Element {
  const navigate = useNavigate();
  const [filename, setFilename] = useState("loan-agreement.txt");
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionRow | null>(null);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [redactBeforeSend, setRedactBeforeSend] = useState(true);

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const r = await extractApi.upload(file, redactBeforeSend);
      setFilename(r.filename);
      setText(r.text);
      const parts: string[] = [`${r.characters.toLocaleString()} chars parsed`];
      if (r.pages !== undefined) parts.push(`${r.pages} page${r.pages === 1 ? "" : "s"}`);
      if (r.redactionsApplied) parts.push(`${r.redactionsApplied} redactions`);
      toast.success(parts.join(" · "));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function runExtraction(): Promise<void> {
    if (text.trim().length < 20) {
      toast.error("Paste at least 20 characters of loan-agreement text.");
      return;
    }
    setRunning(true);
    try {
      const created = await extractApi.create({
        sourceFilename: filename || "loan-agreement.txt",
        documentText: text,
      });
      const result = await extractApi.run(created.extraction.id);
      setExtraction(result.extraction);
      setFlagged(result.flaggedFields);
      if (result.flaggedFields.length > 0) {
        toast.warning(
          `Extracted with ${result.flaggedFields.length} low-confidence field${result.flaggedFields.length === 1 ? "" : "s"}.`,
        );
      } else {
        toast.success("Extraction complete.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(
          "No LLM provider configured. Set ANTHROPIC_API_KEY in the appliance .env to enable AI extraction.",
        );
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
    }
  }

  function applyToWorkbench(): void {
    // Seed the TVM workbench with the extracted loan terms via
    // sessionStorage; the workbench reads the seed on mount.
    if (!extraction?.extractedJson) return;
    sessionStorage.setItem("vibecalc.workbench.seed", JSON.stringify(extraction.extractedJson));
    navigate("/calculators/tvm-workbench");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> AI loan-agreement extraction
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a loan-agreement excerpt below; the appliance extracts the principal, rate, term,
          payment, and other key fields. Every extraction lands at <em>needs_review</em> — verify
          the fields before applying them to a calculation.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source document</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 rounded-md border border-input p-3">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                Upload PDF / DOCX / TXT (≤ 10 MB)
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={uploadFile}
                  disabled={uploading}
                />
                {uploading && <span className="text-xs text-muted-foreground">Parsing…</span>}
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={redactBeforeSend}
                  onChange={(e) => setRedactBeforeSend(e.target.checked)}
                />
                <span>
                  Scrub SSN / EIN / long-digit account numbers before parsing
                  <span className="ml-1 text-muted-foreground">
                    (recommended for cloud-LLM extractions)
                  </span>
                </span>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Filename / label
              </span>
              <Input value={filename} onChange={(e) => setFilename(e.target.value)} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Document text (paste from PDF / Word / scanner OCR)
              </span>
              <textarea
                className="h-72 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder="Paste the loan-agreement text here…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {text.length.toLocaleString()} characters. The model sees this verbatim — trim to
                the relevant section to keep cost low.
              </p>
            </label>
            <div className="mt-3 flex justify-end">
              <Button onClick={runExtraction} disabled={running || text.trim().length < 20}>
                {running ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <FileSearch className="mr-1 h-4 w-4" />
                )}
                {running ? "Extracting…" : "Extract"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extracted fields</CardTitle>
          </CardHeader>
          <CardContent>
            {!extraction && (
              <p className="text-sm text-muted-foreground">
                Run an extraction to see the structured fields here. Low-confidence fields will be
                flagged and require explicit confirmation before they can be applied.
              </p>
            )}
            {extraction && (
              <ExtractionView
                extraction={extraction}
                documentText={text}
                flagged={flagged}
                onApply={applyToWorkbench}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

interface ExtractionViewProps {
  extraction: ExtractionRow;
  documentText: string;
  flagged: string[];
  onApply: () => void;
}

function ExtractionView({
  extraction,
  documentText,
  flagged,
  onApply,
}: ExtractionViewProps): JSX.Element {
  const j = extraction.extractedJson;
  const [activeQuoteKey, setActiveQuoteKey] = useState<string | null>(null);
  if (!j) return <p className="text-sm text-muted-foreground">No fields extracted.</p>;
  const flaggedSet = new Set(flagged);
  const sourceQuotes = (j.sourceQuotes ?? {}) as Record<string, string>;
  const rows: { key: string; label: string; value: unknown }[] = [
    { key: "borrower", label: "Borrower", value: get(j, "borrower.name") },
    { key: "lender", label: "Lender", value: get(j, "lender.name") },
    { key: "principal", label: "Principal", value: format(j.principal) },
    { key: "interestRate", label: "Interest rate", value: formatPct(j.interestRate) },
    { key: "compounding", label: "Compounding", value: j.compounding ?? "—" },
    { key: "termMonths", label: "Term (months)", value: j.termMonths ?? "—" },
    { key: "firstPaymentDate", label: "First payment", value: j.firstPaymentDate ?? "—" },
    { key: "paymentFrequency", label: "Payment frequency", value: j.paymentFrequency ?? "—" },
    { key: "paymentAmount", label: "Payment", value: format(j.paymentAmount) },
    {
      key: "prepaymentPenalty",
      label: "Prepayment penalty",
      value: yesNoOrDash(j.prepaymentPenalty),
    },
    { key: "lateFeeNote", label: "Late fees", value: j.lateFeeNote ?? "—" },
    { key: "variableRateClause", label: "Variable-rate", value: j.variableRateClause ?? "—" },
  ];

  return (
    <div className="space-y-3">
      {/* Phase 23.10 — source-highlight panel. Two columns: document
         text on the left with the active field's quote highlighted,
         extracted fields on the right. Clicking a field with a quote
         scrolls the doc to the quote and highlights it. */}
      {documentText && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <SourceTextPane
            text={documentText}
            activeQuote={activeQuoteKey ? (sourceQuotes[activeQuoteKey] ?? null) : null}
          />
          <FieldsPane
            rows={rows}
            flaggedSet={flaggedSet}
            sourceQuotes={sourceQuotes}
            activeQuoteKey={activeQuoteKey}
            setActiveQuoteKey={setActiveQuoteKey}
          />
        </div>
      )}
      {!documentText && (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="w-1/3 py-1.5 pr-2 text-muted-foreground">{row.label}</td>
                <td className="py-1.5 font-medium">
                  {row.value as string}
                  {flaggedSet.has(row.key) && (
                    <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                      review
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {typeof j.notes === "string" && j.notes.length > 0 && (
        <div className="rounded-md bg-muted px-3 py-2 text-xs">
          <p className="mb-1 font-medium">Notes</p>
          <p>{j.notes}</p>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onApply}>Apply to workbench →</Button>
      </div>
    </div>
  );
}

function FieldsPane({
  rows,
  flaggedSet,
  sourceQuotes,
  activeQuoteKey,
  setActiveQuoteKey,
}: {
  rows: { key: string; label: string; value: unknown }[];
  flaggedSet: Set<string>;
  sourceQuotes: Record<string, string>;
  activeQuoteKey: string | null;
  setActiveQuoteKey: (k: string | null) => void;
}): JSX.Element {
  return (
    <div className="overflow-y-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => {
            const hasQuote = sourceQuotes[row.key] !== undefined;
            const isActive = activeQuoteKey === row.key;
            return (
              <tr
                key={row.key}
                onClick={() => {
                  if (!hasQuote) return;
                  setActiveQuoteKey(isActive ? null : row.key);
                }}
                className={
                  "border-b last:border-b-0 " +
                  (hasQuote ? "cursor-pointer hover:bg-accent/40 " : "") +
                  (isActive ? "bg-primary/10" : "")
                }
              >
                <td className="w-1/3 px-3 py-1.5 text-muted-foreground">{row.label}</td>
                <td className="px-3 py-1.5 font-medium">
                  {row.value as string}
                  {flaggedSet.has(row.key) && (
                    <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                      review
                    </span>
                  )}
                  {hasQuote && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      📌 click to highlight
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceTextPane({
  text,
  activeQuote,
}: {
  text: string;
  activeQuote: string | null;
}): JSX.Element {
  // Build segments: [before, match, after, ...] when an active quote
  // is set. Quotes are matched verbatim (case-sensitive). The model
  // is instructed to copy substrings exactly, so a no-match means the
  // model fabricated; we fall through to plain text in that case.
  const segments = activeQuote ? splitOnQuote(text, activeQuote) : [{ text, highlight: false }];
  return (
    <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-sm">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Source document</p>
      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
        {segments.map((seg, i) =>
          seg.highlight ? (
            <mark
              key={i}
              className="rounded bg-amber-300/60 px-0.5 dark:bg-amber-400/30"
              ref={(el) => {
                // Auto-scroll the highlight into view when it mounts.
                if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </pre>
    </div>
  );
}

function splitOnQuote(text: string, quote: string): { text: string; highlight: boolean }[] {
  const idx = text.indexOf(quote);
  if (idx < 0) return [{ text, highlight: false }];
  const segments: { text: string; highlight: boolean }[] = [];
  if (idx > 0) segments.push({ text: text.slice(0, idx), highlight: false });
  segments.push({ text: quote, highlight: true });
  const after = text.slice(idx + quote.length);
  if (after) segments.push({ text: after, highlight: false });
  return segments;
}

function get(obj: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return "—";
  }
  return cur === null || cur === undefined ? "—" : String(cur);
}

function format(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(4)}%`;
}

function yesNoOrDash(b: unknown): string {
  if (b === true) return "Yes";
  if (b === false) return "No";
  return "—";
}
