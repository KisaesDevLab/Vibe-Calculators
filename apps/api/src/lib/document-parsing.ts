/**
 * Phase 23.7 — extract plain text from uploaded loan-agreement
 * documents.
 *
 * Supported types:
 *   - text/plain            (UTF-8)
 *   - application/pdf       (via pdf-parse)
 *   - application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *                           (via mammoth)
 *
 * The extracted text is returned to the caller for preview-and-edit
 * before the LLM extraction runs (Phase 23.6 — operator gets to trim
 * to the relevant section before paying for tokens).
 */

import mammoth from "mammoth";
// pdf-parse's package main runs a debug self-test that reads a fixture
// at module load time — it explodes with ENOENT in any consumer that
// doesn't ship the fixture. The internal `lib/pdf-parse.js` is the
// real implementation; importing it directly skips the buggy preamble.
// @ts-expect-error — no type declaration for the deep import; we reuse
// the package's existing types via the cast below.
import pdfParseInner from "pdf-parse/lib/pdf-parse.js";
import type pdfParse from "pdf-parse";
const pdfParseFn: typeof pdfParse = pdfParseInner;

export class DocumentParseError extends Error {
  constructor(
    public readonly mimeType: string,
    message: string,
  ) {
    super(message);
    this.name = "DocumentParseError";
  }
}

const MAX_TEXT_OUTPUT = 500_000; // matches the createSchema cap in extractions.ts

// ASCII control chars except CR (\r) / LF (\n) / TAB (\t).
// Built via `new RegExp(...)` to keep the literal source clean of any
// invisible / irregular whitespace that a literal /[…]/ regex would
// hide. eslint-disable for no-control-regex is intentional — the
// whole point of this regex is to delete control characters that
// downstream consumers (LLM prompts, JSON serialization) reject.
// eslint-disable-next-line no-control-regex
const STRIP_CONTROL = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]", "g");

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<{ text: string; pages?: number; characters: number }> {
  const lower = mimeType.toLowerCase();
  let text: string;
  let pages: number | undefined;

  if (lower === "text/plain" || filename.toLowerCase().endsWith(".txt")) {
    text = buffer.toString("utf8");
  } else if (lower === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    try {
      const r = await pdfParseFn(buffer);
      text = r.text;
      pages = r.numpages;
    } catch (err) {
      throw new DocumentParseError(
        mimeType,
        `pdf-parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (
    lower === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.toLowerCase().endsWith(".docx")
  ) {
    try {
      const r = await mammoth.extractRawText({ buffer });
      text = r.value;
    } catch (err) {
      throw new DocumentParseError(
        mimeType,
        `mammoth failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    throw new DocumentParseError(
      mimeType,
      `Unsupported MIME type: ${mimeType}. Accepted: text/plain, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
    );
  }

  // Strip control chars then collapse 3+ blank lines to 2 (some PDF
  // extractors emit huge whitespace runs).
  text = text
    .replace(STRIP_CONTROL, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > MAX_TEXT_OUTPUT) {
    text = text.slice(0, MAX_TEXT_OUTPUT);
  }

  return {
    text,
    ...(pages !== undefined ? { pages } : {}),
    characters: text.length,
  };
}

/**
 * Phase 23.5 — redaction pipeline for cloud-LLM safety.
 *
 * Best-effort scrubbing of US SSN / EIN patterns before the prompt
 * leaves the appliance. NOT a substitute for proper data-minimization —
 * the operator is told the document is sent to Anthropic and chooses
 * to upload anyway. This pass catches the obvious lifts.
 */
export function redactSensitive(text: string): { redacted: string; replacements: number } {
  let count = 0;
  // SSN: 3-2-4 digits with optional dashes/spaces. Don't redact 9-digit
  // strings without delimiters (too many false positives, e.g. ZIP+4).
  const ssn = /\b\d{3}[ -]\d{2}[ -]\d{4}\b/g;
  // EIN: 2-7 digits with dash.
  const ein = /\b\d{2}-\d{7}\b/g;
  // Account-like long digits (≥ 10) — heuristic; flagged as ACCOUNT.
  const account = /\b\d{10,16}\b/g;

  let redacted = text.replace(ssn, () => {
    count++;
    return "[REDACTED-SSN]";
  });
  redacted = redacted.replace(ein, () => {
    count++;
    return "[REDACTED-EIN]";
  });
  redacted = redacted.replace(account, () => {
    count++;
    return "[REDACTED-ACCOUNT]";
  });
  return { redacted, replacements: count };
}
