export const DB_PACKAGE = "@vibe-calc/db" as const;

// Connection factory + the Drizzle Database type.
export * from "./connection";

// Soft-delete helpers.
export * from "./soft-delete";
export * from "./tax-table-resolver";

// Every table + its inferred Row / NewRow types.
export * from "./schema/_meta";
export * from "./schema/users";
export * from "./schema/sessions";
export * from "./schema/password-reset-tokens";
export * from "./schema/magic-link-tokens";
export * from "./schema/recovery-codes";
export * from "./schema/auth-events";
export * from "./schema/clients";
export * from "./schema/engagements";
export * from "./schema/calculations";
export * from "./schema/tags";
export * from "./schema/bootstrap-tokens";
export * from "./schema/tax-year-tables";
export * from "./schema/audit-events";
export * from "./schema/schedules";
export * from "./schema/extractions";
export * from "./schema/api-keys";

// Convenience re-export so consumers can pass `db.query.<table>` etc.
export * as schema from "./schema/index";
