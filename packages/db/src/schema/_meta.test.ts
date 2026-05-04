import { describe, expect, it } from "vitest";
import { _meta } from "./_meta";
import { getTableColumns, getTableName } from "drizzle-orm";

describe("_meta schema", () => {
  it("uses the table name '_meta'", () => {
    expect(getTableName(_meta)).toBe("_meta");
  });

  it("has the expected columns", () => {
    const cols = getTableColumns(_meta);
    expect(Object.keys(cols).sort()).toEqual(["bootstrappedAt", "notes", "schemaVersion"]);
  });

  it("declares schema_version as the primary key", () => {
    const cols = getTableColumns(_meta);
    expect(cols.schemaVersion.primary).toBe(true);
    expect(cols.schemaVersion.notNull).toBe(true);
  });

  it("declares bootstrapped_at as not-null with a default", () => {
    const cols = getTableColumns(_meta);
    expect(cols.bootstrappedAt.notNull).toBe(true);
    expect(cols.bootstrappedAt.hasDefault).toBe(true);
  });

  it("declares notes as nullable", () => {
    const cols = getTableColumns(_meta);
    expect(cols.notes.notNull).toBe(false);
  });
});
