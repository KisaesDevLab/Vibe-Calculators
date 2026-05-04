import { describe, expect, it, vi } from "vitest";
import { createBootstrapManager, printBootstrapBanner } from "./bootstrap.js";

describe("bootstrap manager", () => {
  it("starts in 'closed' state until refresh sees an empty users table", () => {
    const m = createBootstrapManager();
    expect(m.getState().kind).toBe("closed");
  });

  it("issueToken returns null when state is closed", () => {
    const m = createBootstrapManager();
    expect(m.issueToken()).toBeNull();
  });

  it("issueToken returns a 64-hex token after refresh sees empty users", async () => {
    const m = createBootstrapManager();
    // Stub the DB to report zero users.
    const fakeDb = {
      select: () => ({ from: async () => [{ n: 0 }] }),
    } as unknown as Parameters<typeof m.refresh>[0];
    await m.refresh(fakeDb);
    const token = m.issueToken();
    expect(token).not.toBeNull();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyToken accepts the issued token and rejects others", async () => {
    const m = createBootstrapManager();
    const fakeDb = {
      select: () => ({ from: async () => [{ n: 0 }] }),
    } as unknown as Parameters<typeof m.refresh>[0];
    await m.refresh(fakeDb);
    const token = m.issueToken()!;
    expect(m.verifyToken(token)).toBe(true);
    expect(m.verifyToken(token + "0")).toBe(false);
    expect(m.verifyToken("0".repeat(token.length))).toBe(false);
  });

  it("close() permanently disables verifyToken", async () => {
    const m = createBootstrapManager();
    const fakeDb = {
      select: () => ({ from: async () => [{ n: 0 }] }),
    } as unknown as Parameters<typeof m.refresh>[0];
    await m.refresh(fakeDb);
    const token = m.issueToken()!;
    m.close();
    expect(m.verifyToken(token)).toBe(false);
    expect(m.getState().kind).toBe("closed");
  });

  it("refresh transitions to 'closed' once the users table is non-empty", async () => {
    const m = createBootstrapManager();
    const empty = {
      select: () => ({ from: async () => [{ n: 0 }] }),
    } as unknown as Parameters<typeof m.refresh>[0];
    await m.refresh(empty);
    expect(m.getState().kind).toBe("open");

    const populated = {
      select: () => ({ from: async () => [{ n: 1 }] }),
    } as unknown as Parameters<typeof m.refresh>[0];
    await m.refresh(populated);
    expect(m.getState().kind).toBe("closed");
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
