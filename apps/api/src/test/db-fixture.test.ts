import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@vibe-calc/db";
import { makeTestDb, type TestDb, type TestHarness } from "./db-fixture.js";

describe("makeTestDb (testcontainers postgres:16-alpine)", () => {
  let harness: TestHarness;
  let db: TestDb;

  beforeAll(async () => {
    harness = await makeTestDb();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncateAll();
  });

  it("applies migrations: users table accepts an insert and round-trips", async () => {
    const [row] = await db
      .insert(users)
      .values({ email: "alice@example.com", name: "Alice" })
      .returning();
    expect(row).toBeDefined();
    expect(row?.email).toBe("alice@example.com");
    expect(row?.role).toBe("preparer"); // default
    expect(row?.status).toBe("pending"); // default
  });

  it("enforces the unique-email constraint", async () => {
    await db.insert(users).values({ email: "bob@example.com", name: "Bob" });
    await expect(
      db.insert(users).values({ email: "bob@example.com", name: "Bob 2" }),
    ).rejects.toThrow();
  });

  it("CHECK constraint rejects mixed-case email", async () => {
    // Phase 3.9: users_email_format CHECK requires lowercase + @.
    await expect(
      db.insert(users).values({ email: "Carol@example.com", name: "Carol" }),
    ).rejects.toThrow();
  });
});
