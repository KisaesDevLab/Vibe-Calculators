import { pino, type Logger } from "pino";

/**
 * Application logger. Pino structured JSON in production; pretty
 * output in development.
 *
 * Per CLAUDE.md "PII redaction (SSN/EIN/full name) by default".
 * Redaction also covers credentials that would otherwise leak via
 * structured request/response logging:
 *   - Authorization / Cookie headers
 *   - Argon2id password hashes
 *   - TOTP secrets / codes / recovery codes
 *   - Magic-link, password-reset, bootstrap, API key tokens
 *   - SSN / EIN at common path locations
 *
 * The `*.<field>` glob pattern matches the field at any nesting depth.
 * Adding a new sensitive field name above propagates to every logger
 * call site automatically.
 */
const REDACT_PATHS = [
  // Headers
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "headers.authorization",
  "headers.cookie",
  "headers['set-cookie']",
  // Auth + secrets
  "*.password",
  "*.passwordHash",
  "*.password_hash",
  "*.token",
  "*.tokenHash",
  "*.token_hash",
  "*.secret",
  "*.secretSealed",
  "*.totpSecret",
  "*.totpCode",
  "*.totp_code",
  "*.recoveryCode",
  "*.recovery_code",
  "*.codeHash",
  "*.code_hash",
  "*.apiKey",
  "*.api_key",
  "*.bearerToken",
  // Sensitive PII per CLAUDE.md
  "*.ssn",
  "*.SSN",
  "*.ein",
  "*.EIN",
  "*.taxId",
  "*.tax_id",
];

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]", remove: false },
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
    },
  }),
});
