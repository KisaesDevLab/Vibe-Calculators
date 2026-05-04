import Decimal from "decimal.js";
import { forwardRef, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Phase 4.4 — RateInput.
 *
 * Percent input with 6-decimal-place precision. Value is the
 * canonical decimal as a string (e.g. "0.065" for 6.5%); display is
 * "6.500000%" with thousands separators stripped (rates are usually
 * <100% so no commas needed, but if 1234.5% somehow shows up we
 * handle it).
 *
 * "U" toggles unknown.
 */

export interface RateInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  value: string; // canonical decimal "0.065" = 6.5%
  onChange: (next: string) => void;
  unknown?: boolean;
  onUnknownToggle?: () => void;
  /** Decimal places to show. Default 6 per build plan §4.4. */
  decimals?: number;
}

function parsePct(raw: string): Decimal | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.endsWith("%")) s = s.slice(0, -1);
  s = s.replace(/[\s,]/g, "");
  if (s === "" || !/^-?\d*\.?\d*$/.test(s)) return null;
  try {
    // User typed a percentage; canonical form is the decimal fraction.
    return new Decimal(s).div(100);
  } catch {
    return null;
  }
}

function formatPct(value: string, decimals: number): string {
  if (!value) return "";
  try {
    const d = new Decimal(value).times(100);
    return `${d.toFixed(decimals)}%`;
  } catch {
    return value;
  }
}

export const RateInput = forwardRef<HTMLInputElement, RateInputProps>(
  ({ value, onChange, unknown, onUnknownToggle, decimals = 6, className, ...rest }, ref) => {
    const [text, setText] = useState<string>(() => formatPct(value, decimals));
    const [focused, setFocused] = useState(false);

    useEffect(() => {
      if (!focused) setText(formatPct(value, decimals));
    }, [value, focused, decimals]);

    function handleChange(e: ChangeEvent<HTMLInputElement>): void {
      const raw = e.target.value;
      setText(raw);
      const parsed = parsePct(raw);
      if (parsed) onChange(parsed.toString());
      else if (raw === "" || raw === "-") onChange("");
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      if ((e.key === "u" || e.key === "U") && !e.ctrlKey && !e.metaKey) {
        if (text === "") {
          e.preventDefault();
          onUnknownToggle?.();
        }
      }
    }

    function handleBlur(): void {
      setFocused(false);
      const parsed = parsePct(text);
      if (parsed) {
        const canonical = parsed.toString();
        onChange(canonical);
        setText(formatPct(canonical, decimals));
      } else if (text === "") {
        setText("");
      }
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={unknown ? "U" : text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        className={cn(
          "text-right",
          unknown && "font-mono uppercase tracking-wider text-muted-foreground",
          className,
        )}
        {...rest}
      />
    );
  },
);
RateInput.displayName = "RateInput";

export const _internals = { parsePct, formatPct };
