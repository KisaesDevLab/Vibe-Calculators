import { describe, expect, it, vi } from "vitest";
import { printBootstrapBanner, BOOTSTRAP_TOKEN_TTL_HOURS } from "./bootstrap.js";

describe("BOOTSTRAP_TOKEN_TTL_HOURS", () => {
  it("is 24 hours by default", () => {
    expect(BOOTSTRAP_TOKEN_TTL_HOURS).toBe(24);
  });
});

describe("printBootstrapBanner", () => {
  it("emits the token verbatim and a clear single-use warning", () => {
    const lines: string[] = [];
    printBootstrapBanner("abc123-token", (s) => lines.push(s));
    const joined = lines.join("\n");
    expect(joined).toContain("abc123-token");
    expect(joined).toMatch(/one-time/i);
    expect(joined).toMatch(/once/i);
  });

  it("uses the supplied print fn (not console.error)", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lines: string[] = [];
    printBootstrapBanner("token", (s) => lines.push(s));
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
    expect(lines.length).toBeGreaterThan(3);
  });
});

// DB-backed bootstrap (persistBootstrapToken / verifyBootstrapToken /
// createFirstAdmin) is integration-tested in auth-flows.integration.test.ts.
