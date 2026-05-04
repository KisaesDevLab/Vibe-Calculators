import { pino, type Logger } from "pino";

/**
 * Application logger. Pino structured JSON in production; pretty
 * output in development. Phase 2.8+ adds correlation IDs and PII
 * redaction; this is the foundation.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
    },
  }),
});
