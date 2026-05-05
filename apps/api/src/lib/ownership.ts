import { eq, inArray, or, sql } from "drizzle-orm";
import { calculations, engagements, extractionJobs, type Database } from "@vibe-calc/db";
import type { Role } from "@vibe-calc/shared-types";

/**
 * IDOR guards for calculation / engagement / extraction reads + mutations.
 *
 * Threat model: a preparer or reviewer must not be able to read or
 * mutate calcs / engagements they're not assigned to. Admins bypass
 * the check (they need firm-wide visibility). Readonly users can read
 * everything in scope of `client:read` but are blocked from mutations
 * by permission middleware upstream.
 *
 * Ownership shape:
 *   - admin OR readonly                       → all rows
 *   - preparer/reviewer assigned to engagement→ rows under that engagement
 *   - preparer/reviewer who CREATED the calc  → that calc (orphan calcs
 *                                               with no engagement still
 *                                               belong to their author)
 *
 * The functions return arrays of permitted IDs; the caller intersects
 * with the requested IDs and rejects on mismatch.
 */

interface ScopeContext {
  db: Database;
  userId: string;
  role: Role;
}

/**
 * Returns the IDs of engagements the user is permitted to interact with.
 * Admins / readonly users get every non-archived engagement (readonly
 * is read-only by permission middleware; the visibility scope is firm-wide).
 * Preparers / reviewers get only engagements assigned to them.
 */
export async function permittedEngagementIds(ctx: ScopeContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  if (ctx.role === "admin" || ctx.role === "readonly") {
    const rows = await ctx.db
      .select({ id: engagements.id })
      .from(engagements)
      .where(inArray(engagements.id, ids));
    return rows.map((r) => r.id);
  }
  const rows = await ctx.db
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      sql`${engagements.id} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}) AND (${engagements.assignedPreparerId} = ${ctx.userId} OR ${engagements.assignedReviewerId} = ${ctx.userId})`,
    );
  return rows.map((r) => r.id);
}

/**
 * Returns the IDs of calculations the user is permitted to interact with.
 * Admin / readonly: any calc. Preparer/reviewer: calcs whose parent
 * engagement is assigned to them, OR calcs the user created (computedBy)
 * — the latter covers orphan calcs not yet attached to an engagement.
 */
export async function permittedCalculationIds(ctx: ScopeContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  if (ctx.role === "admin" || ctx.role === "readonly") {
    const rows = await ctx.db
      .select({ id: calculations.id })
      .from(calculations)
      .where(inArray(calculations.id, ids));
    return rows.map((r) => r.id);
  }
  // Pull each row + parent engagement; filter in code so the SQL stays
  // simple. For typical CPA scale (<200 calcs in any one bulk) this is
  // fine; index lookups dominate.
  const rows = await ctx.db
    .select({
      id: calculations.id,
      computedBy: calculations.computedBy,
      engagementId: calculations.engagementId,
      preparerId: engagements.assignedPreparerId,
      reviewerId: engagements.assignedReviewerId,
    })
    .from(calculations)
    .leftJoin(engagements, eq(calculations.engagementId, engagements.id))
    .where(inArray(calculations.id, ids));
  return rows
    .filter(
      (r) =>
        r.computedBy === ctx.userId || r.preparerId === ctx.userId || r.reviewerId === ctx.userId,
    )
    .map((r) => r.id);
}

/**
 * Returns the IDs of extraction jobs the user is permitted to access.
 * Mirrors the calculation scoping: admin/readonly all; others see jobs
 * they created or that hang off an engagement assigned to them.
 */
export async function permittedExtractionIds(ctx: ScopeContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  if (ctx.role === "admin" || ctx.role === "readonly") {
    const rows = await ctx.db
      .select({ id: extractionJobs.id })
      .from(extractionJobs)
      .where(inArray(extractionJobs.id, ids));
    return rows.map((r) => r.id);
  }
  const rows = await ctx.db
    .select({
      id: extractionJobs.id,
      createdBy: extractionJobs.createdBy,
      engagementId: extractionJobs.engagementId,
      preparerId: engagements.assignedPreparerId,
      reviewerId: engagements.assignedReviewerId,
    })
    .from(extractionJobs)
    .leftJoin(engagements, eq(extractionJobs.engagementId, engagements.id))
    .where(inArray(extractionJobs.id, ids));
  return rows
    .filter(
      (r) =>
        r.createdBy === ctx.userId || r.preparerId === ctx.userId || r.reviewerId === ctx.userId,
    )
    .map((r) => r.id);
}

/**
 * Boolean form for single-id checks.
 */
export async function userOwnsCalculation(
  ctx: ScopeContext,
  calculationId: string,
): Promise<boolean> {
  const ok = await permittedCalculationIds(ctx, [calculationId]);
  return ok.length === 1;
}

export async function userOwnsExtraction(
  ctx: ScopeContext,
  extractionId: string,
): Promise<boolean> {
  const ok = await permittedExtractionIds(ctx, [extractionId]);
  return ok.length === 1;
}

export async function userOwnsEngagement(
  ctx: ScopeContext,
  engagementId: string,
): Promise<boolean> {
  const ok = await permittedEngagementIds(ctx, [engagementId]);
  return ok.length === 1;
}

// drizzle's `or` helper isn't used here directly but kept on the surface
// in case future scoping needs it.
export const _internalOr = or;
