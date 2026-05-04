import { forwardRef, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Phase 4.4 — PeriodInput.
 *
 * Quantity-with-unit picker for "Number × Period" entries (e.g.
 * 12 months, 30 years). Input parses suffix Y/M and toggles
 * between years/months. Value is months for downstream solver
 * convenience; the toggle just changes display.
 *
 * Build plan calls for "12Y → months toggle" — we accept the user
 * typing "12Y" and store value=144 (months), or typing "144" with
 * unit toggled to "Months" stored=144. Either path round-trips.
 */

export type PeriodUnit = "months" | "years";

export interface PeriodInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  /** Canonical value: count of MONTHS. */
  value: number | null;
  onChange: (next: number | null) => void;
  unit: PeriodUnit;
  onUnitChange: (unit: PeriodUnit) => void;
  unknown?: boolean;
  onUnknownToggle?: () => void;
}

function valueForDisplay(months: number | null, unit: PeriodUnit): string {
  if (months == null) return "";
  if (unit === "months") return String(months);
  // years
  if (months % 12 === 0) return String(months / 12);
  return (months / 12).toFixed(2);
}

function parseInput(
  raw: string,
  currentUnit: PeriodUnit,
): { months: number | null; unitOverride?: PeriodUnit } {
  const s = raw.trim();
  if (!s) return { months: null };
  const m = /^(-?\d+\.?\d*)\s*([yYmM])?$/.exec(s);
  if (!m) return { months: null };
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return { months: null };
  const suffix = m[2]?.toLowerCase();
  if (suffix === "y") return { months: Math.round(n * 12), unitOverride: "years" };
  if (suffix === "m") return { months: Math.round(n), unitOverride: "months" };
  // No suffix: use current unit
  if (currentUnit === "years") return { months: Math.round(n * 12) };
  return { months: Math.round(n) };
}

export const PeriodInput = forwardRef<HTMLInputElement, PeriodInputProps>(
  ({ value, onChange, unit, onUnitChange, unknown, onUnknownToggle, className, ...rest }, ref) => {
    const [text, setText] = useState<string>(() => valueForDisplay(value, unit));
    const [focused, setFocused] = useState(false);

    useEffect(() => {
      if (!focused) setText(valueForDisplay(value, unit));
    }, [value, unit, focused]);

    function handleChange(e: ChangeEvent<HTMLInputElement>): void {
      const raw = e.target.value;
      setText(raw);
      const { months, unitOverride } = parseInput(raw, unit);
      if (unitOverride && unitOverride !== unit) onUnitChange(unitOverride);
      onChange(months);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      if ((e.key === "u" || e.key === "U") && !e.ctrlKey && !e.metaKey && text === "") {
        e.preventDefault();
        onUnknownToggle?.();
      }
    }

    function handleBlur(): void {
      setFocused(false);
      setText(valueForDisplay(value, unit));
    }

    return (
      <div className={cn("flex gap-1", className)}>
        <Input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={unknown ? "U" : text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          className={cn(
            "flex-1 text-right",
            unknown && "font-mono uppercase tracking-wider text-muted-foreground",
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => onUnitChange(unit === "months" ? "years" : "months")}
          className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          aria-label={`Toggle to ${unit === "months" ? "years" : "months"}`}
        >
          {unit === "months" ? "mo" : "yr"}
        </button>
      </div>
    );
  },
);
PeriodInput.displayName = "PeriodInput";

export const _internals = { valueForDisplay, parseInput };
