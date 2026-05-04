import Decimal from "decimal.js";
import { forwardRef, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Phase 4.4 — MoneyInput.
 *
 * Decimal.js-backed currency input. Per CLAUDE.md "no floats for
 * money or rates, ever" — value is a string (decimal representation)
 * so callers never accidentally lose precision.
 *
 * Features:
 *   - K / M / B suffixes scale the typed number (1.5K -> 1500.00)
 *   - Parens treated as negative ((1,234.56) -> -1234.56)
 *   - Commas allowed and stripped
 *   - "U" key toggles 'unknown' state (caller observes via onUnknownToggle)
 *   - Blur normalizes display to 2 decimal places with thousands separators
 *   - The held value is always a Decimal-compatible string with exact precision
 */

export interface MoneyInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  value: string; // canonical decimal string, e.g. "1234.56"
  onChange: (next: string) => void;
  unknown?: boolean;
  onUnknownToggle?: () => void;
  /** Display currency symbol prefix (e.g. "$"). Pure cosmetic. */
  symbol?: string;
}

const SUFFIX_MULTIPLIERS: Record<string, Decimal> = {
  K: new Decimal(1_000),
  M: new Decimal(1_000_000),
  B: new Decimal(1_000_000_000),
};

function parseInput(raw: string): { decimal: Decimal | null; isNegative: boolean } {
  if (!raw) return { decimal: null, isNegative: false };
  let s = raw.trim();
  let isNegative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    isNegative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    isNegative = true;
    s = s.slice(1);
  }
  s = s.replace(/[$,\s]/g, "");
  const lastChar = s.slice(-1).toUpperCase();
  let multiplier = new Decimal(1);
  if (lastChar in SUFFIX_MULTIPLIERS) {
    multiplier = SUFFIX_MULTIPLIERS[lastChar]!;
    s = s.slice(0, -1);
  }
  if (s === "" || !/^\d*\.?\d*$/.test(s)) return { decimal: null, isNegative };
  try {
    const d = new Decimal(s).times(multiplier);
    return { decimal: isNegative ? d.negated() : d, isNegative };
  } catch {
    return { decimal: null, isNegative };
  }
}

function formatForDisplay(value: string): string {
  if (!value) return "";
  try {
    const d = new Decimal(value);
    const fixed = d.abs().toFixed(2);
    const [whole, decimal] = fixed.split(".");
    const withCommas = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return d.isNeg() ? `-${withCommas}.${decimal}` : `${withCommas}.${decimal}`;
  } catch {
    return value;
  }
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, unknown, onUnknownToggle, symbol = "$", className, ...rest }, ref) => {
    const [displayValue, setDisplayValue] = useState<string>(() => formatForDisplay(value));
    const [focused, setFocused] = useState(false);

    useEffect(() => {
      if (!focused) setDisplayValue(formatForDisplay(value));
    }, [value, focused]);

    function handleChange(e: ChangeEvent<HTMLInputElement>): void {
      const raw = e.target.value;
      setDisplayValue(raw);
      const { decimal } = parseInput(raw);
      if (decimal !== null) {
        onChange(decimal.toFixed(2));
      } else if (raw === "" || raw === "-") {
        onChange("");
      }
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      if ((e.key === "u" || e.key === "U") && !e.ctrlKey && !e.metaKey) {
        if (displayValue === "" || focused === false) {
          e.preventDefault();
          onUnknownToggle?.();
        }
      }
    }

    function handleBlur(): void {
      setFocused(false);
      const { decimal } = parseInput(displayValue);
      if (decimal !== null) {
        const canonical = decimal.toFixed(2);
        onChange(canonical);
        setDisplayValue(formatForDisplay(canonical));
      } else if (displayValue === "") {
        setDisplayValue("");
      }
    }

    return (
      <div className={cn("relative", className)}>
        {!unknown && symbol && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {symbol}
          </span>
        )}
        <Input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={unknown ? "U" : displayValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          className={cn(
            symbol && !unknown ? "pl-7" : "",
            unknown ? "font-mono uppercase tracking-wider text-muted-foreground" : "text-right",
          )}
          aria-invalid={false}
          {...rest}
        />
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";

/** Exposed for tests. */
export const _internals = { parseInput, formatForDisplay };
