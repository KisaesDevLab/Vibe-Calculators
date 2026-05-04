export const DB_PACKAGE = "@vibe-calc/db" as const;

// Connection factory + the Drizzle Database type.
export * from "./connection";

// Soft-delete helpers.
export * from "./soft-delete";

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

// Convenience re-export so consumers can pass `db.query.<table>` etc.
export * as schema from "./schema/index";
