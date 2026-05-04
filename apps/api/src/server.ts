import express, { type Express } from "express";
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
      ScheduleRouteDeps;
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
  app.set("trust proxy", true);
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", buildHealthRouter(options.health));

  if (options.auth) {
    app.use(loadSession(options.auth.middleware));
    app.use("/api/v1/setup", buildSetupRouter(options.auth.routes));
    app.use("/api/v1/auth", buildAuthRouter(options.auth.routes));
    app.use("/api/v1/me", buildMeRouter(options.auth.routes));
    app.use("/api/v1/admin/users", buildAdminUsersRouter(options.auth.routes));
    app.use("/api/v1/clients", buildClientsRouter(options.auth.routes));
    app.use("/api/v1/engagements", buildEngagementsRouter(options.auth.routes));
    app.use("/api/v1/calculations", buildCalculationsRouter(options.auth.routes));
    app.use("/api/v1/calculations/:id", buildVersioningRouter(options.auth.routes));
    app.use("/api/v1/audit", buildAuditRouter(options.auth.routes));
    app.use("/api/v1/schedules", buildSchedulesRouter(options.auth.routes));
    app.use("/api/v1/tags", buildTagsRouter(options.auth.routes));
    app.use("/api/v1/search", buildSearchRouter(options.auth.routes));
    app.use("/api/v1/queue", buildQueueRouter(options.auth.routes));
    app.use("/api/v1/bulk", buildBulkRouter(options.auth.routes));
  }

  return app;
}
