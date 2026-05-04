import express, { type Express } from "express";
import helmet from "helmet";
import { buildHealthRouter, type HealthDependencies } from "./routes/health.js";

export interface ServerOptions {
  health?: HealthDependencies;
}

/**
 * Pure Express app factory. Does not call listen — that's the entry
 * point's job. This shape lets supertest and integration tests boot
 * an isolated app instance.
 */
export function createApp(options: ServerOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", buildHealthRouter(options.health));

  return app;
}
