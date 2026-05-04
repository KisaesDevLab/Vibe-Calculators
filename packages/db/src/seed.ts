/**
 * Phase 3.10 — development seed.
 *
 * Inserts 3 clients, 6 engagements, and a varied set of calculations
 * so the local appliance has plausible-looking data on first boot.
 * Idempotent — re-running is a no-op when seed rows already exist.
 *
 * Invoked via the upcoming `just seed` target (Phase 1.13 stubbed it).
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { calculations, clients, engagements, users, type CalculationKind } from "./schema/index";

const SEED_USER_EMAIL = "seed@vibecalc.local";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required to seed.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString, max: 2 });
  const db = drizzle(pool);

  console.info("[seed] looking up seed user");
  let [seedUser] = await db.select().from(users).where(eq(users.email, SEED_USER_EMAIL));
  if (!seedUser) {
    [seedUser] = await db
      .insert(users)
      .values({
        email: SEED_USER_EMAIL,
        name: "Seed Bot",
        role: "preparer",
        status: "active",
      })
      .returning();
  }

  if (!seedUser) throw new Error("Seed user creation failed");
  const seedUserId = seedUser.id;

  console.info("[seed] inserting clients");
  const clientFixtures = [
    {
      name: "Acme Holdings, LLC",
      entityType: "multi_member_llc" as const,
      ein: "12-3456789",
      addressJson: { line1: "100 Market St", city: "St. Louis", state: "MO", postalCode: "63102" },
      primaryContactJson: { name: "Jane Acme", email: "jane@acme.test", phone: "314-555-0100" },
    },
    {
      name: "Beachside Bistro, Inc.",
      entityType: "s_corp" as const,
      ein: "87-6543210",
      addressJson: { line1: "9 Pier Way", city: "Tampa", state: "FL", postalCode: "33602" },
      primaryContactJson: { name: "Sam Beach", email: "sam@beach.test" },
    },
    {
      name: "Drs. Singh & Patel, P.C.",
      entityType: "c_corp" as const,
      ein: "55-1212343",
      addressJson: {
        line1: "300 Medical Plaza",
        city: "Kansas City",
        state: "MO",
        postalCode: "64108",
      },
      primaryContactJson: { name: "Dr. Anita Singh", email: "asingh@singhpatel.test" },
    },
  ];

  const clientRows = await Promise.all(
    clientFixtures.map(async (c) => {
      const [existing] = await db.select().from(clients).where(eq(clients.name, c.name)).limit(1);
      if (existing) return existing;
      const [row] = await db
        .insert(clients)
        .values({ ...c, createdBy: seedUserId })
        .returning();
      if (!row) throw new Error("Client insert returned no row");
      return row;
    }),
  );

  console.info("[seed] inserting engagements");
  const engagementFixtures = clientRows.flatMap((c, idx) => [
    {
      clientId: c.id,
      name: `${c.name} — 2025 Tax Planning`,
      taxYear: 2025,
      engagementType: "tax_planning" as const,
      assignedPreparerId: seedUserId,
    },
    {
      clientId: c.id,
      name: `${c.name} — 2024 Tax Prep`,
      taxYear: 2024,
      engagementType: "tax_prep" as const,
      assignedPreparerId: seedUserId,
      status: idx === 0 ? ("approved" as const) : ("draft" as const),
    },
  ]);

  const engagementRows = await Promise.all(
    engagementFixtures.map(async (e) => {
      const [existing] = await db
        .select()
        .from(engagements)
        .where(eq(engagements.name, e.name))
        .limit(1);
      if (existing) return existing;
      const [row] = await db.insert(engagements).values(e).returning();
      if (!row) throw new Error("Engagement insert returned no row");
      return row;
    }),
  );

  console.info("[seed] inserting calculations");
  const calcKinds: { kind: CalculationKind; name: string; inputs: Record<string, unknown> }[] = [
    {
      kind: "tvm.amortization",
      name: "30-year mortgage @ 6.5%",
      inputs: { amount: "500000.00", rate: "0.065", termMonths: 360 },
    },
    {
      kind: "tax.macrs",
      name: "Office equipment 2024 (5-year MACRS)",
      inputs: { basis: "12500.00", placedInService: "2024-09-15", classLife: 5 },
    },
    {
      kind: "tax.qbi",
      name: "S-Corp QBI 2024",
      inputs: { qbi: "180000.00", w2Wages: "60000.00", isSSTB: false, taxableIncome: "210000.00" },
    },
    {
      kind: "tax.safe_harbor",
      name: "2025 Q1 safe-harbor estimate",
      inputs: { priorYearTax: "42000.00", agiAboveThreshold: false },
    },
  ];

  for (let i = 0; i < calcKinds.length; i++) {
    const e = engagementRows[i % engagementRows.length]!;
    const c = calcKinds[i]!;
    const [existing] = await db
      .select()
      .from(calculations)
      .where(eq(calculations.name, c.name))
      .limit(1);
    if (existing) continue;
    await db.insert(calculations).values({
      engagementId: e.id,
      clientId: e.clientId,
      kind: c.kind,
      name: c.name,
      inputsJson: c.inputs,
      computedBy: seedUserId,
    });
  }

  await pool.end();
  console.info("[seed] done");
}

main().catch((err: unknown) => {
  console.error("[seed] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
