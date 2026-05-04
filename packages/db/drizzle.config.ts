import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. The migrations folder is committed to git;
 * generated SQL is reviewed in PRs like any other code change.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://vibe:vibe@localhost:5432/vibecalc",
  },
  strict: true,
  verbose: true,
});
