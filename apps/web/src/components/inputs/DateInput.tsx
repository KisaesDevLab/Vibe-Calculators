import { forwardRef, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { addDays, addMonths, addYears, format, parse, isValid } from "date-fns";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Phase 4.4 — DateInput.
 *
 * Smart date entry:
 *   - Typing "010125" auto-formats to "01/01/2025" on blur (or comma).
 *   - Arrow Up/Down adjusts the day by ±1.
 *   - Shift+Arrow adjusts the month by ±1.
 *   - Ctrl+Arrow adjusts the year by ±1.
 *   - "+1m" / "-2y" expressions resolve relative to current value.
 *   - Empty value yields onChange("") so callers can detect cleared.
 *
 * Value is an ISO date string (YYYY-MM-DD) so it round-trips through
 * the API cleanly. Display uses MM/DD/YYYY (US firm convention; later
 * phases will add a per-firm locale toggle).
 */

const DISPLAY_FMT = "MM/dd/yyyy";
const ISO_FMT = "yyyy-MM-dd";

export interface DateInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  value: string; // ISO YYYY-MM-DD or empty
  onChange: (next: string) => void;
}

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const d = parse(iso, ISO_FMT, new Date());
  if (!isValid(d)) return "";
  return format(d, DISPLAY_FMT);
}

function tryParseDisplay(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Compact form: 010125 -> 01/01/2025; 01012025 -> 01/01/2025
  const compact6 = /^(\d{2})(\d{2})(\d{2})$/.exec(trimmed);
  if (compact6) {
    const [, mm, dd, yy] = compact6;
    const yyyy = Number(yy) >= 50 ? `19${yy}` : `20${yy}`;
    return parseDateMDY(`${mm}/${dd}/${yyyy}`);
  }
  const compact8 = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  if (compact8) {
    const [, mm, dd, yyyy] = compact8;
    return parseDateMDY(`${mm}/${dd}/${yyyy}`);
  }
  return parseDateMDY(trimmed);
}

function parseDateMDY(text: string): Date | null {
  const d = parse(text, DISPLAY_FMT, new Date());
  return isValid(d) ? d : null;
}

function applyDelta(
  text: string,
  value: string,
  deltaDays = 0,
  deltaMonths = 0,
  deltaYears = 0,
): string | null {
  const base = tryParseDisplay(text) ?? (value ? parse(value, ISO_FMT, new Date()) : null);
  if (!base || !isValid(base)) return null;
  let d = base;
  if (deltaDays) d = addDays(d, deltaDays);
  if (deltaMonths) d = addMonths(d, deltaMonths);
  if (deltaYears) d = addYears(d, deltaYears);
  return format(d, ISO_FMT);
}

function tryRelative(text: string, base: Date | null): Date | null {
  const m = /^([+-]?)(\d+)([dmy])$/i.exec(text.trim());
  if (!m) return null;
  const [, sign, n, unit] = m;
  const dir = sign === "-" ? -1 : 1;
  const amount = dir * Number(n);
  const start = base ?? new Date();
  if (!isValid(start)) return null;
  if (unit?.toLowerCase() === "d") return addDays(start, amount);
  if (unit?.toLowerCase() === "m") return addMonths(start, amount);
  return addYears(start, amount);
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, ...rest }, ref) => {
    const [text, setText] = useState<string>(() => isoToDisplay(value));
    const [focused, setFocused] = useState(false);

    useEffect(() => {
      if (!focused) setText(isoToDisplay(value));
    }, [value, focused]);

    function commit(rawText: string): void {
      // Try absolute parse first
      const direct = tryParseDisplay(rawText);
      if (direct) {
        onChange(format(direct, ISO_FMT));
        setText(format(direct, DISPLAY_FMT));
        return;
      }
      // Try relative ("+1m")
      const base = value ? parse(value, ISO_FMT, new Date()) : null;
      const rel = tryRelative(rawText, base);
      if (rel) {
        onChange(format(rel, ISO_FMT));
        setText(format(rel, DISPLAY_FMT));
        return;
      }
      if (rawText.trim() === "") {
        onChange("");
        setText("");
      }
    }

    function handleChange(e: ChangeEvent<HTMLInputElement>): void {
      setText(e.target.value);
    }

    function handleBlur(): void {
      setFocused(false);
      commit(text);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      const isArrowUp = e.key === "ArrowUp";
      const isArrowDown = e.key === "ArrowDown";
      if (!isArrowUp && !isArrowDown) {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(text);
        }
        return;
      }
      e.preventDefault();
      const dir = isArrowUp ? 1 : -1;
      let next: string | null;
      if (e.ctrlKey) {
        next = applyDelta(text, value, 0, 0, dir);
      } else if (e.shiftKey) {
        next = applyDelta(text, value, 0, dir, 0);
      } else {
        next = applyDelta(text, value, dir, 0, 0);
      }
      if (next) {
        onChange(next);
        setText(format(parse(next, ISO_FMT, new Date()), DISPLAY_FMT));
      }
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder="MM/DD/YYYY"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        className={cn("font-mono tracking-tight", className)}
        {...rest}
      />
    );
  },
);
DateInput.displayName = "DateInput";

export const _internals = { tryParseDisplay, isoToDisplay, applyDelta, tryRelative };
