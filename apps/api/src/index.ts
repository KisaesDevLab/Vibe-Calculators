import { loadEnv } from "./lib/env.js";

// Validate env BEFORE importing any module that touches process.env.
// Failure prints a structured error and exits with EX_CONFIG (78).
const env = loadEnv();

const { createApp } = await import("./server.js");
const { logger } = await import("./lib/logger.js");
const { closeDatabase } = await import("./lib/db.js");
const { closeRedis } = await import("./lib/redis.js");

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, mode: env.VIBE_DEPLOY_MODE, offline: env.VIBE_OFFLINE },
    "Vibe Calculators API listening",
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close(() => undefined);
  await Promise.allSettled([closeDatabase(), closeRedis()]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
