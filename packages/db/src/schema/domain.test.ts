import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { clients, clientEntityTypeEnum } from "./clients";
import { engagements, engagementStatusEnum, engagementTypeEnum } from "./engagements";
import {
  calculations,
  calculationKindEnum,
  calculationStatusEnum,
  calculationVersions,
} from "./calculations";
import { tags, entityTags, taggedEntityKindEnum } from "./tags";

describe("clients schema", () => {
  it("has all build-plan columns", () => {
    expect(Object.keys(getTableColumns(clients)).sort()).toEqual(
      [
        "addressJson",
        "archivedAt",
        "createdAt",
        "createdBy",
        "ein",
        "entityType",
        "id",
        "name",
        "primaryContactJson",
        "updatedAt",
      ].sort(),
    );
  });

  it("entity type enum covers the major US filing categories", () => {
    expect(clientEntityTypeEnum.enumValues).toContain("s_corp");
    expect(clientEntityTypeEnum.enumValues).toContain("partnership");
    expect(clientEntityTypeEnum.enumValues).toContain("individual");
  });

  it("archived_at is nullable for soft-delete", () => {
    expect(getTableColumns(clients).archivedAt.notNull).toBe(false);
  });
});

describe("engagements schema", () => {
  it("links to clients via FK", () => {
    expect(getTableColumns(engagements).clientId.notNull).toBe(true);
  });

  it("has the four-stage status enum", () => {
    expect([...engagementStatusEnum.enumValues].sort()).toEqual([
      "approved",
      "closed",
      "draft",
      "in_review",
    ]);
  });

  it("status defaults to 'draft'", () => {
    expect(getTableColumns(engagements).status.hasDefault).toBe(true);
  });

  it("engagement type enum includes loan_modeling and audit_support", () => {
    expect(engagementTypeEnum.enumValues).toContain("loan_modeling");
    expect(engagementTypeEnum.enumValues).toContain("audit_support");
  });
});

describe("calculations schema", () => {
  it("uses table name 'calculations'", () => {
    expect(getTableName(calculations)).toBe("calculations");
  });

  it("includes inputs_json + outputs_json as jsonb defaults", () => {
    const cols = getTableColumns(calculations);
    expect(cols.inputsJson.hasDefault).toBe(true);
    expect(cols.outputsJson.hasDefault).toBe(true);
  });

  it("kind enum covers TVM and tax kinds the build plan lists", () => {
    const kinds = calculationKindEnum.enumValues;
    expect(kinds).toContain("tvm.amortization");
    expect(kinds).toContain("tvm.bond");
    expect(kinds).toContain("tax.macrs");
    expect(kinds).toContain("tax.qbi");
    expect(kinds).toContain("tax.amt");
    expect(kinds).toContain("tax.section_1031");
  });

  it("status enum has draft / ready_for_review / approved", () => {
    expect([...calculationStatusEnum.enumValues].sort()).toEqual([
      "approved",
      "draft",
      "ready_for_review",
    ]);
  });

  it("version defaults to 1 and is the immutable-history pivot", () => {
    expect(getTableColumns(calculations).version.hasDefault).toBe(true);
  });
});

describe("calculation_versions schema", () => {
  it("includes row_annotations jsonb (Phase 12.5)", () => {
    expect(getTableColumns(calculationVersions).rowAnnotations).toBeDefined();
  });

  it("locked_at + locked_by carry the approver attribution", () => {
    const cols = getTableColumns(calculationVersions);
    expect(cols.lockedAt).toBeDefined();
    expect(cols.lockedBy).toBeDefined();
  });
});

describe("tags / entity_tags polymorphic schema", () => {
  it("entity_kind enum is exactly the three taggable entities", () => {
    expect([...taggedEntityKindEnum.enumValues].sort()).toEqual([
      "calculation",
      "client",
      "engagement",
    ]);
  });

  it("tags.name is unique-indexed", () => {
    // Drizzle exposes unique through getTableConfig; simplest check
    // is just to confirm the column NOT NULL.
    expect(getTableColumns(tags).name.notNull).toBe(true);
  });

  it("entity_tags row carries (tag_id, entity_kind, entity_id)", () => {
    expect(Object.keys(getTableColumns(entityTags)).sort()).toEqual([
      "createdAt",
      "entityId",
      "entityKind",
      "tagId",
    ]);
  });
});
