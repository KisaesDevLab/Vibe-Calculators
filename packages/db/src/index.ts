export const DB_PACKAGE = "@vibe-calc/db" as const;

// Connection factory + the Drizzle Database type.
export * from "./connection";

// Every table + its inferred Row / NewRow types.
export * from "./schema/_meta";
export * from "./schema/users";
export * from "./schema/sessions";
export * from "./schema/password-reset-tokens";
export * from "./schema/magic-link-tokens";

// Convenience re-export so consumers can pass `db.query.<table>` etc.
export * as schema from "./schema/index";
