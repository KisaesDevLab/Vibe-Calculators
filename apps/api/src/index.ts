import { loadEnv } from "./lib/env.js";

// Validate env BEFORE importing any module that touches process.env.
// Failure prints a structured error and exits with EX_CONFIG (78).
const env = loadEnv();

// Lazy imports so loadEnv() runs first; modules below may read
// process.env at module init.
const { createApp } = await import("./server.js");
const { logger } = await import("./lib/logger.js");
const { closeDatabase, pingDatabase } = await import("./lib/db.js");
const { closeRedis, pingRedis } = await import("./lib/redis.js");
const { getVersionInfo } = await import("./lib/version.js");
const { createDatabase } = await import("@vibe-calc/db");
const { createKms } = await import("./lib/kms.js");
const { sealerFrom } = await import("./lib/totp.js");
const { createRateLimiter, redisStore } = await import("./lib/rate-limit.js");
const { Redis } = await import("ioredis");
const { createEmailProviderFromEnv } = await import("@vibe-calc/email");
const { runDeepHealth } = await import("./lib/deep-health.js");

// Side-effect imports: importing @vibe-calc/tax-engine triggers each
// calculator module's registerCalculator() call, populating the global
// registry. registerTvmCalculators() does the same for the seven
// calc-engine TVM templates we wrap as registry-shaped calculators.
// Both must happen before the calculators route reads the registry.
await import("@vibe-calc/tax-engine");
const { registerTvmCalculators } = await import("./lib/tvm-calculators.js");
registerTvmCalculators();

const { AnthropicProvider } = await import("@vibe-calc/llm");

// Drizzle DB used by every auth-aware route.
const { db, pool } = createDatabase({ connectionString: env.DATABASE_URL });

// KMS for TOTP secret sealing (Phase 2.5) and webhook secret sealing
// (security-pass-2 H8). VIBE_KMS_KEY is required in production by the
// env validator; createKms throws on missing/short keys.
const kms = createKms(env.VIBE_KMS_KEY);
const totpSealer = sealerFrom(kms);

// Dedicated Redis client for the rate-limiter — separate from the
// health-check ping client so a stuck health probe can't starve auth
// throttling, and vice versa. lazyConnect: false so failures show up
// in `npm start` rather than on first auth attempt.
const rateLimitRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});
rateLimitRedis.on("error", (err) => {
  logger.error({ err: err.message }, "rate-limit redis error");
});
const rateLimiter = createRateLimiter(redisStore(rateLimitRedis));

// Optional email provider. The factory throws on misconfigured envs
// (e.g. provider=smtp but SMTP_HOST blank), which is normal in dev:
// log the magic-link details so the operator can copy the URL by
// hand. In production this surfaces as a warning at boot, and the
// firm operator wires real credentials in their .env.
type EmailLikeProvider = {
  send: (input: { to: string; subject: string; text: string }) => Promise<unknown>;
};
let emailProvider: EmailLikeProvider | null = null;
try {
  emailProvider = createEmailProviderFromEnv(process.env);
  logger.info({ provider: process.env.VIBE_EMAIL_PROVIDER ?? "smtp" }, "email provider ready");
} catch (err) {
  logger.warn(
    { reason: err instanceof Error ? err.message : String(err) },
    "email provider not configured — magic-link emails will be logged only",
  );
}

// Optional LLM provider for Phase 23 loan-extraction. The appliance
// reads ANTHROPIC_API_KEY (and optional VIBE_LLM_DEFAULT_MODEL) from
// .env. When unset, the extractions route returns 503 with a clear
// "no LLM provider configured" message — the rest of the appliance
// works offline-clean.
const llmProvider =
  process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0
    ? new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultModel: process.env.VIBE_LLM_DEFAULT_MODEL ?? undefined,
      })
    : undefined;
if (llmProvider) {
  logger.info({ model: process.env.VIBE_LLM_DEFAULT_MODEL ?? "default" }, "LLM provider ready");
} else {
  logger.info("LLM provider not configured — Phase 23 extractions will return 503");
}

const emitMagicLinkEmail = async (input: {
  email: string;
  token: string;
  consumeUrl: string;
  expiresAt: Date;
}): Promise<void> => {
  if (emailProvider) {
    try {
      await emailProvider.send({
        to: input.email,
        subject: "Sign in to Vibe Calculators",
        text:
          `A sign-in link was requested for this address.\n\n` +
          `Open: ${input.consumeUrl}\n\n` +
          `This link expires at ${input.expiresAt.toISOString()}. ` +
          `If you didn't request it, ignore this message.`,
      });
      return;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), email: input.email },
        "magic-link email delivery failed — falling back to log",
      );
    }
  }
  logger.info(
    {
      email: input.email,
      consumeUrl: input.consumeUrl,
      expiresAt: input.expiresAt.toISOString(),
    },
    "magic-link issued (no email transport configured — copy the consumeUrl above)",
  );
};

// Number of migration tags shipped with this release; bumped each
// time a new file lands in packages/db/drizzle/. The deep-health
// schema-version probe asserts the applied count matches.
const EXPECTED_MIGRATIONS = 14; // 0000..0013

const app = createApp({
  health: {
    pingDb: pingDatabase,
    pingRedis,
    getVersion: getVersionInfo,
    deepCheck: () =>
      runDeepHealth({
        pool,
        redis: rateLimitRedis,
        expectedMigrations: EXPECTED_MIGRATIONS,
        ...(process.env.VIBE_QUEUE_PREFIX ? { queuePrefix: process.env.VIBE_QUEUE_PREFIX } : {}),
      }),
  },
  auth: {
    middleware: { db, env: { VIBE_DEPLOY_MODE: env.VIBE_DEPLOY_MODE } },
    routes: {
      db,
      env: { VIBE_DEPLOY_MODE: env.VIBE_DEPLOY_MODE },
      rateLimiter,
      totpSealer,
      kms,
      emitMagicLinkEmail,
      llmProvider,
    },
  },
});

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, mode: env.VIBE_DEPLOY_MODE, offline: env.VIBE_OFFLINE },
    "Vibe Calculators API listening",
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close(() => undefined);
  await Promise.allSettled([
    pool.end(),
    rateLimitRedis.quit().catch(() => undefined),
    closeDatabase(),
    closeRedis(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
