import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@vibe-calc/db";
import { makeTestDb, type TestDb } from "./db-fixture.js";

describe("makeTestDb", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
  });

  afterAll(async () => {
    await close();
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
});
