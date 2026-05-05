import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/inputs/MoneyInput";
import { DateInput } from "@/components/inputs/DateInput";
import { RateInput } from "@/components/inputs/RateInput";
import { deref, type JsonSchema } from "./api";

/**
 * Phase 15.4 — JSON-Schema-driven auto-form.
 *
 * Renders one field per top-level property of the calculator's input
 * JSON schema. Field-component selection is heuristic:
 *   - `format: "date"` or property name ending in `Date`     → DateInput
 *   - property name in {amount, face, balance, payment, …}   → MoneyInput
 *   - property name in {rate, yield, …}                      → RateInput
 *   - schema.enum                                            → <select>
 *   - schema.type "boolean"                                  → checkbox
 *   - schema.type "array" with items "object"                → repeating
 *                                                              row group
 *   - schema.type "number" / "integer"                       → numeric input
 *   - schema.type "object"                                   → recursive
 *                                                              section
 *   - everything else                                        → text input
 *
 * The form aggregates an opaque {[key]: unknown} state object that
 * is shipped to the compute endpoint as-is. The server-side Zod
 * schema is the authority — UI-side validation is intentionally
 * minimal so we don't drift from the schema.
 */

export interface AutoFormProps {
  schema: JsonSchema;
  /** Initial values, e.g. last-saved inputs. */
  defaults?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
}

const MONEY_HINTS = [
  "amount",
  "face",
  "balance",
  "payment",
  "price",
  "value",
  "deposit",
  "cost",
  "wages",
  "income",
  "limit",
  "loan",
  "principal",
  "basis",
  "salary",
  "agi",
  "fv",
  "pv",
];
const RATE_HINTS = ["rate", "yield", "apr", "apy", "discount"];

function isMoneyField(name: string): boolean {
  const lower = name.toLowerCase();
  return MONEY_HINTS.some((h) => lower.includes(h));
}
function isRateField(name: string): boolean {
  const lower = name.toLowerCase();
  return RATE_HINTS.some((h) => lower.includes(h));
}
function isDateField(name: string, schema: JsonSchema): boolean {
  if (schema.format === "date") return true;
  return name.toLowerCase().endsWith("date");
}

function deriveDefault(schema: JsonSchema): unknown {
  if ("default" in schema) return schema.default;
  if (schema.type === "string") return "";
  if (schema.type === "number" || schema.type === "integer") return undefined;
  if (schema.type === "boolean") return false;
  if (schema.type === "array") return [];
  if (schema.type === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) obj[k] = deriveDefault(v);
    return obj;
  }
  return undefined;
}

function initialValues(
  schema: JsonSchema,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, prop] of Object.entries(schema.properties ?? {})) {
    if (overrides && k in overrides) {
      obj[k] = overrides[k];
    } else {
      const v = deriveDefault(prop);
      if (v !== undefined) obj[k] = v;
    }
  }
  return obj;
}

function humanLabel(key: string): string {
  // "couponRate" -> "Coupon rate", "ein_number" -> "Ein number"
  const split = key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return split.charAt(0).toUpperCase() + split.slice(1).toLowerCase();
}

interface FieldProps {
  name: string;
  schema: JsonSchema;
  rootSchema: JsonSchema;
  value: unknown;
  required: boolean;
  onChange: (next: unknown) => void;
}

function Field({ name, schema, rootSchema, value, required, onChange }: FieldProps): JSX.Element {
  const resolved = deref(rootSchema, schema);
  const label = humanLabel(name);
  const id = `f-${name}`;

  if (resolved.enum && resolved.enum.length > 0) {
    const opts = resolved.enum;
    return (
      <label htmlFor={id} className="block">
        <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </span>
        <select
          id={id}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          value={(value as string | number | undefined) ?? ""}
          onChange={(e) => {
            // Coerce back to original type
            const v = e.target.value;
            const original = opts.find((o) => String(o) === v);
            onChange(original);
          }}
        >
          {!required && <option value="">—</option>}
          {opts.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
        {resolved.description && (
          <p className="mt-1 text-xs text-muted-foreground">{resolved.description}</p>
        )}
      </label>
    );
  }

  if (resolved.type === "boolean") {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }

  if (resolved.type === "number" || resolved.type === "integer") {
    if (isRateField(name)) {
      return (
        <label htmlFor={id} className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
            <span className="ml-1 text-muted-foreground/70">(decimal: 0.05 = 5%)</span>
          </span>
          <RateInput
            id={id}
            value={value === undefined ? "" : String(value)}
            onChange={(s) => onChange(s === "" ? undefined : Number(s))}
          />
        </label>
      );
    }
    if (isMoneyField(name)) {
      return (
        <label htmlFor={id} className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
          </span>
          <MoneyInput
            id={id}
            value={value === undefined ? "" : String(value)}
            onChange={(s) => onChange(s === "" ? undefined : Number(s))}
          />
        </label>
      );
    }
    return (
      <label htmlFor={id} className="block">
        <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </span>
        <Input
          id={id}
          type="number"
          step={resolved.type === "integer" ? 1 : "any"}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </label>
    );
  }

  if (resolved.type === "string" && isDateField(name, resolved)) {
    return (
      <label htmlFor={id} className="block">
        <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </span>
        <DateInput
          id={id}
          value={(value as string | undefined) ?? ""}
          onChange={(s) => onChange(s === "" ? undefined : s)}
        />
      </label>
    );
  }

  if (resolved.type === "array" && resolved.items) {
    const itemSchema = deref(rootSchema, resolved.items);
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    return (
      <fieldset className="rounded-md border border-input p-3">
        <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
          {label} ({arr.length})
        </legend>
        <div className="space-y-2">
          {arr.map((item, idx) => (
            <div key={idx} className="rounded border border-input/50 p-2">
              {itemSchema.type === "object" && itemSchema.properties ? (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(itemSchema.properties).map(([subKey, subSchema]) => (
                    <Field
                      key={subKey}
                      name={subKey}
                      schema={subSchema}
                      rootSchema={rootSchema}
                      value={(item as Record<string, unknown>)[subKey]}
                      required={(itemSchema.required ?? []).includes(subKey)}
                      onChange={(v) => {
                        const next = [...arr];
                        next[idx] = { ...((item as object) ?? {}), [subKey]: v };
                        onChange(next);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <Input
                  value={String(item ?? "")}
                  onChange={(e) => {
                    const next = [...arr];
                    next[idx] = e.target.value;
                    onChange(next);
                  }}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(arr.filter((_, i) => i !== idx))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const newItem = itemSchema.type === "object" ? (deriveDefault(itemSchema) ?? {}) : "";
              onChange([...arr, newItem]);
            }}
          >
            + Add row
          </Button>
        </div>
      </fieldset>
    );
  }

  if (resolved.type === "object" && resolved.properties) {
    const obj = (value as Record<string, unknown>) ?? {};
    return (
      <fieldset className="rounded-md border border-input p-3">
        <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
          {label}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(resolved.properties).map(([subKey, subSchema]) => (
            <Field
              key={subKey}
              name={subKey}
              schema={subSchema}
              rootSchema={rootSchema}
              value={obj[subKey]}
              required={(resolved.required ?? []).includes(subKey)}
              onChange={(v) => onChange({ ...obj, [subKey]: v })}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  // Fallback: text input.
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      <Input
        id={id}
        value={(value as string | number | undefined)?.toString() ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function AutoForm({
  schema,
  defaults,
  onSubmit,
  submitting,
  submitLabel,
}: AutoFormProps): JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(schema, defaults),
  );
  const required = schema.required ?? [];

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void onSubmit(values);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(schema.properties ?? {}).map(([key, propSchema]) => (
          <Field
            key={key}
            name={key}
            schema={propSchema}
            rootSchema={schema}
            value={values[key]}
            required={required.includes(key)}
            onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Computing…" : (submitLabel ?? "Compute")}
        </Button>
      </div>
    </form>
  );
}
