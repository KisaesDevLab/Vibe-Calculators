import { Router, type Request, type Response } from "express";

/**
 * Phase 24.4 — public OpenAPI spec.
 *
 * Hand-written rather than auto-derived because:
 *   - the Zod-to-OpenAPI converter ecosystem is unstable across major
 *     versions and would lock us to one converter's quirks
 *   - the spec is small enough to maintain manually
 *   - it's easier to write a CI test that diffs the generated spec
 *     against this file than to wire a generator into the build
 *
 * GET /api/v1/openapi.json  → spec (no auth required; the spec
 *                             itself contains no secrets)
 */

export function buildOpenApiRouter(): Router {
  const router = Router();

  router.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(SPEC);
  });

  return router;
}

const SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Vibe Calculators API",
    version: "1.0.0",
    description:
      "Public REST API for Vibe Calculators. Authenticate with a session cookie or `Authorization: Bearer vibe_<token>` (per-firm API key).",
    contact: { name: "Vibe Calculators" },
  },
  servers: [{ url: "/api/v1", description: "Default" }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "vibecalc_sid" },
      apiKey: { type: "http", scheme: "bearer", bearerFormat: "vibe_xxxxx" },
    },
    schemas: {
      Problem: {
        type: "object",
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
        },
      },
    },
  },
  security: [{ apiKey: [] }, { sessionCookie: [] }],
  paths: {
    "/clients": {
      get: { summary: "List clients", responses: { "200": { description: "ok" } } },
      post: { summary: "Create client", responses: { "201": { description: "created" } } },
    },
    "/clients/{id}": {
      get: { summary: "Get client detail" },
      patch: { summary: "Update client" },
    },
    "/engagements": {
      get: { summary: "List engagements" },
      post: { summary: "Create engagement" },
    },
    "/engagements/{id}/transition": {
      post: {
        summary: "Workflow transition",
        description: "draft → in_review → approved → closed. Approve requires reviewer role.",
      },
    },
    "/calculations": {
      get: { summary: "List calculations" },
      post: { summary: "Create calculation" },
    },
    "/calculations/{id}/save": {
      post: { summary: "Save new immutable version" },
    },
    "/calculations/{id}/rollback": {
      post: { summary: "Rollback creates a new version copying an old payload" },
    },
    "/calculations/{id}/approve": {
      post: { summary: "Approve calculation (reviewer); locks version" },
    },
    "/extractions": {
      get: { summary: "List AI-extraction jobs" },
      post: { summary: "Create extraction job (text-in)" },
    },
    "/extractions/{id}/run": {
      post: { summary: "Run LLM extraction; returns parsed JSON + flagged fields" },
    },
    "/schedules": {
      get: { summary: "List schedules" },
      post: { summary: "Create schedule" },
    },
    "/audit/events": { get: { summary: "Audit log (admin)" } },
    "/audit/chain/validate": { get: { summary: "Validate audit-event hash chain" } },
    "/admin/api-keys": {
      get: { summary: "List API keys (admin)" },
      post: { summary: "Issue API key (admin); plaintext returned once" },
    },
    "/webhooks": {
      get: { summary: "List webhook subscriptions" },
      post: { summary: "Create webhook subscription; secret returned once" },
    },
    "/openapi.json": {
      get: { summary: "OpenAPI spec for this API", security: [] },
    },
  },
};
