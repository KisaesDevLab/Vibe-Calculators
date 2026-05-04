import { describe, expect, it } from "vitest";
import { getCalculator, listCalculators } from "./index.js";
import { runFixtures } from "./fixture-runner.js";
import { toyDouble } from "./calculators/toy-double.js";

describe("Phase 15 — calculator framework", () => {
  it("the toy.double calculator is registered automatically", () => {
    const calc = getCalculator("toy.double");
    expect(calc).toBeDefined();
    expect(calc?.metadata.name).toBe("Double (toy)");
  });

  it("listCalculators surfaces every registered kind", () => {
    const kinds = listCalculators().map((c) => c.metadata.kind);
    expect(kinds).toContain("toy.double");
  });

  it("toyDouble compute is pure (no side effects, deterministic)", () => {
    const r1 = toyDouble.compute({ value: 7 }, { tables: new Map(), asOf: new Date() });
    const r2 = toyDouble.compute({ value: 7 }, { tables: new Map(), asOf: new Date() });
    expect(r1).toEqual({ doubled: 14 });
    expect(r2).toEqual({ doubled: 14 });
  });

  it("toyDouble validateInputs surfaces zod issue paths on bad input", () => {
    const r = toyDouble.validateInputs({ value: "not a number" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe("value");
    }
  });

  it("toyDouble narrate produces a sentence containing both numbers", () => {
    const text = toyDouble.narrate(
      { value: 7 },
      { doubled: 14 },
      { tables: new Map(), asOf: new Date() },
    );
    expect(text).toContain("7");
    expect(text).toContain("14");
  });
});

describe("fixture runner", () => {
  runFixtures(toyDouble, [
    {
      name: "doubles 5",
      taxYear: 2024,
      input: { value: 5 },
      expectedOutput: { doubled: 10 },
      source: "n/a",
    },
    {
      name: "doubles 0",
      taxYear: 2024,
      input: { value: 0 },
      expectedOutput: { doubled: 0 },
      source: "n/a",
    },
    {
      name: "doubles a fractional input",
      taxYear: 2025,
      input: { value: 3.14 },
      expectedOutput: { doubled: 6.28 },
      source: "n/a",
      toleranceDollars: 0.01,
    },
  ]);
});
