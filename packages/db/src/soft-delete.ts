import { isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Phase 3.8 — soft-delete utilities.
 *
 * Every user-facing entity has an `archived_at timestamptz` column.
 * The convention: app code reads non-archived rows by default. Use
 * notArchived(table.archivedAt) in any WHERE clause that should
 * return only live rows; admin tools that operate on the trash bin
 * pass `includeArchived: true` and skip the filter.
 *
 * Hard-delete is admin-only and goes through a separate, explicit
 * `db.delete(...)` call (typically gated by requirePermission(...)).
 */
export function notArchived(col: PgColumn): SQL<unknown> {
  return isNull(col);
}
