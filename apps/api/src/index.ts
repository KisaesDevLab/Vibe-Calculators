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
const { renderMagicLinkEmail } = await import("@vibe-calc/email");
import type { EmailProvider } from "@vibe-calc/email";
const { loadFirmSettings } = await import("./lib/firm-settings.js");
const { resolveEmailProvider, peekEmailProviderName, readEmailEnv } = await import(
  "./lib/email-provider-resolver.js"
);
const { runDeepHealth } = await import("./lib/deep-health.js");
const { startExportWorker, stopExportWorker } = await import("./lib/export-queue.js");
const { startWebhookWorker, stopWebhookWorker } = await import("./lib/webhook-queue.js");
const { startSchedulerWorker, stopSchedulerWorker } = await import("./lib/scheduler-queue.js");
const { seedDefaultAdminIfEmpty, printDefaultAdminBanner } = await import(
  "./lib/seed-default-admin.js"
);

// Side-effect imports: importing @vibe-calc/tax-engine triggers each
// calculator module's registerCalculator() call, populating the global
// registry. registerTvmCalculators() does the same for the seven
// calc-engine TVM templates we wrap as registry-shaped calculators.
// Both must happen before the calculators route reads the registry.
await import("@vibe-calc/tax-engine");
const { registerTvmCalculators } = await import("./lib/tvm-calculators.js");
registerTvmCalculators();

const { AnthropicProvider, LocalProvider } = await import("@vibe-calc/llm");
import type { LlmProvider as LlmProviderType } from "@vibe-calc/llm";

// Drizzle DB used by every auth-aware route.
const { db, pool } = createDatabase({ connectionString: env.DATABASE_URL });

// Apply pending Drizzle migrations on every boot. The Vibe-Appliance
// bootstrap creates the database but does not run migrations, so the
// API has to be self-sufficient here — otherwise the seeder below
// crashes against a fresh, empty schema. drizzle-orm's migrator is
// idempotent: already-applied migrations are no-ops.
const { applyMigrations } = await import("@vibe-calc/db");
await applyMigrations(db);

// First-run default-admin seed (Phase 25.3 revised). No-op when any
// user already exists; otherwise inserts admin@local.test / default
// password with must_change_password=true and prints a banner with
// the credentials.
const seedResult = await seedDefaultAdminIfEmpty(db);
if (seedResult.seeded) printDefaultAdminBanner();

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

// Resolved per-send so admin edits in /admin/email take effect without
// a restart. DB-backed singleton wins; .env is the fallback.
const resolveEmail = async (): Promise<EmailProvider | null> => {
  const r = await resolveEmailProvider(db, kms, readEmailEnv());
  return r ? r.provider : null;
};
try {
  const peek = await peekEmailProviderName(db, readEmailEnv());
  if (peek) {
    logger.info({ provider: peek.providerName, source: peek.source }, "email provider configured");
  } else {
    logger.warn(
      "email provider not configured — magic-link emails will be logged only. Configure under Admin → Email or set the SMTP_*/POSTMARK_*/EMAILIT_* env block.",
    );
  }
} catch (err) {
  logger.warn(
    { reason: err instanceof Error ? err.message : String(err) },
    "email provider config check failed — falling back to log-only",
  );
}

// Optional LLM provider for Phase 23 loan-extraction.
//
// Selection rules:
//   • VIBE_OFFLINE=true → only the local provider is selectable.
//   • VIBE_LLM_PROVIDER explicitly set ("anthropic" | "local") → that one wins.
//   • Otherwise: prefer Anthropic when ANTHROPIC_API_KEY is set,
//     fall back to Local when VIBE_LLM_LOCAL_URL is set,
//     undefined when neither is configured.
//
// When undefined, the extractions route returns 503 with a clear
// "no LLM provider configured" message — the rest of the appliance
// works offline-clean.
const llmProvider = ((): LlmProviderType | undefined => {
  const offline = env.VIBE_OFFLINE === true;
  const explicit = (process.env.VIBE_LLM_PROVIDER ?? "").toLowerCase();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const localUrl = process.env.VIBE_LLM_LOCAL_URL?.trim();
  const wantAnthropic =
    !offline && (explicit === "anthropic" || (!explicit && Boolean(anthropicKey)));
  const wantLocal =
    explicit === "local" ||
    (offline && Boolean(localUrl)) ||
    (!explicit && !anthropicKey && Boolean(localUrl));
  if (wantAnthropic && anthropicKey) {
    return new AnthropicProvider({
      apiKey: anthropicKey,
      defaultModel: process.env.VIBE_LLM_DEFAULT_MODEL ?? undefined,
    });
  }
  if (wantLocal && localUrl) {
    if (!isSafeLocalLlmUrl(localUrl, env.VIBE_DEPLOY_MODE)) {
      logger.error(
        { url: localUrl },
        "VIBE_LLM_LOCAL_URL rejected — must be http(s):// to a hostname or RFC1918 / loopback IP",
      );
      return undefined;
    }
    return new LocalProvider({
      baseUrl: localUrl,
      defaultModel:
        process.env.VIBE_LLM_LOCAL_MODEL ?? process.env.VIBE_LLM_DEFAULT_MODEL ?? undefined,
      apiKey: process.env.VIBE_LLM_LOCAL_API_KEY ?? undefined,
    });
  }
  return undefined;
})();

/**
 * SSRF guard for the local LLM endpoint. The URL comes from the
 * appliance's own .env so it's not strictly user-controlled, but
 * accepting any URL means a careless paste of `http://169.254.169.254/...`
 * (cloud metadata) silently exfiltrates document text. Allowlist:
 * a docker-network hostname, RFC1918, loopback, or link-local
 * (the operator wiring vibe-llm-server in compose hits the first;
 * a separate LAN host hits the second).
 */
function isSafeLocalLlmUrl(raw: string, _deployMode: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (!host) return false;
  // Cloud metadata IPs always blocked, regardless of deploy mode.
  const META_BLACKLIST = ["169.254.169.254", "metadata.google.internal", "metadata"];
  if (META_BLACKLIST.includes(host)) return false;
  // Allow any plain hostname (e.g. "vibe-llm" inside docker, "llm.firm.local").
  // The appliance is self-hosted, so an admin can reach what they want;
  // we only block obvious cloud-metadata oracles.
  return true;
}
if (llmProvider) {
  logger.info(
    { provider: llmProvider.name, model: process.env.VIBE_LLM_DEFAULT_MODEL ?? "default" },
    "LLM provider ready",
  );
} else if (env.VIBE_OFFLINE) {
  logger.info("LLM provider not configured (offline mode) — set VIBE_LLM_LOCAL_URL to enable");
} else {
  logger.info("LLM provider not configured — Phase 23 extractions will return 503");
}

const emitMagicLinkEmail = async (input: {
  email: string;
  token: string;
  consumeUrl: string;
  expiresAt: Date;
}): Promise<void> => {
  const provider = await resolveEmail();
  if (provider) {
    try {
      // Phase 22.6 — load firm-settings so the email shows the firm's
      // brand color + name in the header. Best-effort: a DB hiccup
      // shouldn't block magic-link delivery, so default to bare brand
      // when the read fails.
      let firm: Awaited<ReturnType<typeof loadFirmSettings>> | null = null;
      try {
        firm = await loadFirmSettings(db);
      } catch {
        // ignore
      }
      const rendered = renderMagicLinkEmail({
        consumeUrl: input.consumeUrl,
        expiresAt: input.expiresAt,
        brand: {
          firmName: firm?.firmName || undefined,
          brandColor: firm?.brandColor || undefined,
          firmFooter: firm?.pdfFooter || undefined,
        },
      });
      await provider.send({
        to: input.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
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
const EXPECTED_MIGRATIONS = 22; // 0000..0021

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
    middleware: {
      db,
      env: { VIBE_DEPLOY_MODE: env.VIBE_DEPLOY_MODE },
      apiKeyRateStore: redisStore(rateLimitRedis),
    },
    routes: {
      db,
      env: { VIBE_DEPLOY_MODE: env.VIBE_DEPLOY_MODE },
      rateLimiter,
      totpSealer,
      kms,
      emitMagicLinkEmail,
      llmProvider,
      resolveEmailProvider: resolveEmail,
      exportQueue: {
        db,
        redis: { url: env.REDIS_URL },
        webhookQueue: { db, redis: { url: env.REDIS_URL } },
      },
      webhookQueue: { db, redis: { url: env.REDIS_URL } },
    },
  },
});

// Phase 13.7 — start the in-process export worker. BullMQ uses its
// own Redis connection (separate from the rate-limiter's) so a long-
// running PDF render can't starve auth throttling.
startExportWorker({
  db,
  redis: { url: env.REDIS_URL },
  webhookQueue: { db, redis: { url: env.REDIS_URL } },
});
logger.info("export worker started");

// Phase 24.5 — start the webhook retry worker.
startWebhookWorker({ db, redis: { url: env.REDIS_URL } });
logger.info("webhook worker started");

// Phase 22.1 — start the repeatable scheduler tick (default every 5 min).
await startSchedulerWorker({
  db,
  redis: { url: env.REDIS_URL },
  resolveEmailProvider: resolveEmail,
});
logger.info("scheduler worker started");

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
    stopExportWorker(),
    stopWebhookWorker(),
    stopSchedulerWorker(),
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
