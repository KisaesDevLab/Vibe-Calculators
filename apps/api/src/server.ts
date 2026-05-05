// Patches Express 4's router so async route handlers can throw and the
// error reaches our error-handler middleware. Express 5 has this built
// in; we'd remove this on the upgrade. MUST be imported before express.
import "express-async-errors";

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { buildHealthRouter, type HealthDependencies } from "./routes/health.js";
import { buildAuthRouter, type AuthRouteDeps } from "./routes/auth.js";
import { buildSetupRouter, type SetupRouteDeps } from "./routes/setup.js";
import { buildMeRouter, type MeRouteDeps } from "./routes/me.js";
import { buildAdminUsersRouter, type AdminUserRouteDeps } from "./routes/admin-users.js";
import { buildClientsRouter, type ClientRouteDeps } from "./routes/clients.js";
import { buildEngagementsRouter, type EngagementRouteDeps } from "./routes/engagements.js";
import { buildCalculationsRouter, type CalculationRouteDeps } from "./routes/calculations.js";
import { buildTagsRouter, type TagsRouteDeps } from "./routes/tags.js";
import { buildSearchRouter, type SearchRouteDeps } from "./routes/search.js";
import { buildQueueRouter, type QueueRouteDeps } from "./routes/queue.js";
import { buildBulkRouter, type BulkRouteDeps } from "./routes/bulk-actions.js";
import { buildVersioningRouter, type VersioningRouteDeps } from "./routes/versioning.js";
import { buildAuditRouter, type AuditRouteDeps } from "./routes/audit.js";
import { buildSchedulesRouter, type ScheduleRouteDeps } from "./routes/schedules.js";
import { buildExtractionsRouter, type ExtractionRouteDeps } from "./routes/extractions.js";
import { buildApiKeysRouter, type ApiKeysRouteDeps } from "./routes/api-keys.js";
import { buildWebhooksRouter, type WebhooksRouteDeps } from "./routes/webhooks.js";
import { buildCalculatorsRouter, type CalculatorsRouteDeps } from "./routes/calculators.js";
import { buildWorkbenchRouter } from "./routes/workbench.js";
import { buildAdminAiRouter, type AdminAiRouteDeps } from "./routes/admin-ai.js";
import { buildBulkExportRouter, type BulkExportRouteDeps } from "./routes/bulk-export.js";
import { buildExportsRouter, type ExportRouteDeps } from "./routes/exports.js";
import { buildAdminBackupsRouter, type AdminBackupsRouteDeps } from "./routes/admin-backups.js";
import {
  buildAdminTaxTablesRouter,
  type AdminTaxTablesRouteDeps,
} from "./routes/admin-tax-tables.js";
import {
  buildAdminAiPromptsRouter,
  type AdminAiPromptsRouteDeps,
} from "./routes/admin-ai-prompts.js";
import { buildFirmSettingsRouter, type FirmSettingsRouteDeps } from "./routes/firm-settings.js";
import { buildOpenApiRouter } from "./routes/openapi.js";
import { loadSession, type AuthMiddlewareOptions } from "./middleware/auth.js";

export interface ServerOptions {
  health?: HealthDependencies;
  /** When set, the server wires every auth-aware route. */
  auth?: {
    middleware: AuthMiddlewareOptions;
    routes: AuthRouteDeps &
      SetupRouteDeps &
      MeRouteDeps &
      AdminUserRouteDeps &
      ClientRouteDeps &
      EngagementRouteDeps &
      CalculationRouteDeps &
      TagsRouteDeps &
      SearchRouteDeps &
      QueueRouteDeps &
      BulkRouteDeps &
      VersioningRouteDeps &
      AuditRouteDeps &
      ScheduleRouteDeps &
      ExtractionRouteDeps &
      ApiKeysRouteDeps &
      WebhooksRouteDeps &
      CalculatorsRouteDeps &
      AdminAiRouteDeps &
      AdminAiPromptsRouteDeps &
      FirmSettingsRouteDeps &
      BulkExportRouteDeps &
      ExportRouteDeps &
      AdminBackupsRouteDeps &
      AdminTaxTablesRouteDeps;
  };
}

/**
 * Pure Express app factory. Does not call listen — that's the entry
 * point's job. This shape lets supertest and integration tests boot
 * an isolated app instance.
 */
export function createApp(options: ServerOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  // Trust ONE hop (Caddy ingress) only. `true` would honor any
  // X-Forwarded-For value, including attacker-supplied ones when the
  // API is reachable outside Caddy. Per Express docs, a numeric hop
  // count is the safer default.
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", buildHealthRouter(options.health));
  app.use("/api/v1", buildOpenApiRouter());

  if (options.auth) {
    app.use(loadSession(options.auth.middleware));
    app.use("/api/v1/setup", buildSetupRouter(options.auth.routes));
    app.use("/api/v1/auth", buildAuthRouter(options.auth.routes));
    app.use("/api/v1/me", buildMeRouter(options.auth.routes));
    app.use("/api/v1/admin/users", buildAdminUsersRouter(options.auth.routes));
    app.use("/api/v1/admin/api-keys", buildApiKeysRouter(options.auth.routes));
    app.use("/api/v1/webhooks", buildWebhooksRouter(options.auth.routes));
    app.use("/api/v1/clients", buildClientsRouter(options.auth.routes));
    app.use("/api/v1/engagements", buildEngagementsRouter(options.auth.routes));
    app.use("/api/v1/calculations", buildCalculationsRouter(options.auth.routes));
    app.use("/api/v1/calculations/:id", buildVersioningRouter(options.auth.routes));
    app.use("/api/v1/audit", buildAuditRouter(options.auth.routes));
    app.use("/api/v1/schedules", buildSchedulesRouter(options.auth.routes));
    app.use("/api/v1/extractions", buildExtractionsRouter(options.auth.routes));
    app.use("/api/v1/tags", buildTagsRouter(options.auth.routes));
    app.use("/api/v1/search", buildSearchRouter(options.auth.routes));
    app.use("/api/v1/queue", buildQueueRouter(options.auth.routes));
    app.use("/api/v1/bulk", buildBulkRouter(options.auth.routes));
    app.use("/api/v1/calculators", buildCalculatorsRouter(options.auth.routes));
    app.use(
      "/api/v1/workbench",
      buildWorkbenchRouter({
        db: options.auth.routes.db,
        ...(options.auth.routes.emailProvider
          ? { emailProvider: options.auth.routes.emailProvider }
          : {}),
      }),
    );
    app.use(
      "/api/v1/admin/ai",
      buildAdminAiRouter({
        ...(options.auth.routes.llmProvider
          ? { llmProvider: options.auth.routes.llmProvider }
          : {}),
        db: options.auth.routes.db,
      }),
    );
    app.use("/api/v1/admin/firm-settings", buildFirmSettingsRouter(options.auth.routes));
    app.use("/api/v1/admin/ai-prompts", buildAdminAiPromptsRouter(options.auth.routes));
    app.use("/api/v1/calculations/bulk", buildBulkExportRouter(options.auth.routes));
    app.use(
      "/api/v1/exports",
      buildExportsRouter({
        db: options.auth.routes.db,
        ...(options.auth.routes.exportQueue ? { queue: options.auth.routes.exportQueue } : {}),
      }),
    );
    app.use("/api/v1/admin/backups", buildAdminBackupsRouter(options.auth.routes));
    app.use("/api/v1/admin/tax-tables", buildAdminTaxTablesRouter(options.auth.routes));
  }

  // Final RFC 7807 error handler — never leak stack traces or
  // internal error messages to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = errorStatus(err);
    res.status(status).json({
      type: status === 500 ? "about:blank#internal" : "about:blank#error",
      title: status === 500 ? "Internal error" : "Request error",
      status,
      detail: status === 500 ? "An internal error occurred." : safeMessage(err),
    });
  });

  return app;
}

function errorStatus(err: unknown): number {
  if (err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number") {
    return err.statusCode;
  }
  return 500;
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) {
    // Trim noisy internal details — message only, never stack.
    return err.message.length > 200 ? err.message.slice(0, 200) + "…" : err.message;
  }
  return "Unknown error";
}
