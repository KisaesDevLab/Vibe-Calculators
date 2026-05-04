import { createApp } from "./server.js";
import { logger } from "./lib/logger.js";
import { closeDatabase } from "./lib/db.js";
import { closeRedis } from "./lib/redis.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

const server = app.listen(port, () => {
  logger.info({ port }, "Vibe Calculators API listening");
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
