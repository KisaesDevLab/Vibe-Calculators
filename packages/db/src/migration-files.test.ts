import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");

describe("drizzle migrations", () => {
  it("includes the 0000_initial migration", () => {
    const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("0000_initial.sql");
  });

  it("includes the 0001_auth_schema migration", () => {
    const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("0001_auth_schema.sql");
  });

  it("creates the four phase-2 tables", () => {
    const sql = readFileSync(join(drizzleDir, "0001_auth_schema.sql"), "utf8");
    for (const t of ["users", "sessions", "password_reset_tokens", "magic_link_tokens"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
    }
  });

  it("declares the four user roles", () => {
    const sql = readFileSync(join(drizzleDir, "0001_auth_schema.sql"), "utf8");
    expect(sql).toMatch(/'admin'/);
    expect(sql).toMatch(/'reviewer'/);
    expect(sql).toMatch(/'preparer'/);
    expect(sql).toMatch(/'readonly'/);
  });

  it("creates the _meta table with the documented columns", () => {
    const sql = readFileSync(join(drizzleDir, "0000_initial.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "_meta"/);
    expect(sql).toMatch(/"schema_version" text PRIMARY KEY NOT NULL/);
    expect(sql).toMatch(/"bootstrapped_at" timestamp with time zone DEFAULT now\(\) NOT NULL/);
    expect(sql).toMatch(/"notes" text/);
  });

  it("has a journal recording the bootstrap migration", () => {
    const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    expect(journal.entries[0]?.tag).toBe("0000_initial");
  });
});
