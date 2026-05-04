import { z } from "zod";

/**
 * Boot-time environment validation.
 *
 * The Express app calls loadEnv() before any other module reads
 * process.env. On failure we print a structured error and exit non-zero
 * — matching the build plan's "exits with a clear error on missing
 * values" requirement so misconfigured deploys fail loudly at start
 * rather than silently mis-behaving in production.
 */

const deployMode = z.enum(["lan", "domain", "tailscale"]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
        message: "DATABASE_URL must start with postgres:// or postgresql://",
      }),

    REDIS_URL: z
      .string()
      .min(1, "REDIS_URL is required")
      .refine((v) => v.startsWith("redis://") || v.startsWith("rediss://"), {
        message: "REDIS_URL must start with redis:// or rediss://",
      }),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    VIBE_DEPLOY_MODE: deployMode.default("lan"),
    VIBE_DOMAIN: z.string().min(1).optional(),
    VIBE_TLS_EMAIL: z.string().email().optional(),

    VIBE_OFFLINE: z
      .union([z.literal("true"), z.literal("false")])
      .default("false")
      .transform((v) => v === "true"),

    VIBE_KMS_KEY: z.string().optional(),

    GIT_SHA: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.VIBE_DEPLOY_MODE === "domain") {
      if (!env.VIBE_DOMAIN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["VIBE_DOMAIN"],
          message: "VIBE_DOMAIN is required when VIBE_DEPLOY_MODE is 'domain'",
        });
      }
      if (!env.VIBE_TLS_EMAIL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["VIBE_TLS_EMAIL"],
          message: "VIBE_TLS_EMAIL is required when VIBE_DEPLOY_MODE is 'domain'",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(
    public readonly issues: { path: string; message: string }[],
    public readonly source: "process.env" | "explicit",
  ) {
    super(
      `Environment validation failed:\n` +
        issues.map((i) => `  - ${i.path || "<root>"}: ${i.message}`).join("\n"),
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Validates a raw env-like object.
 *
 * The default loadEnv() reads process.env, but tests pass an explicit
 * object so they can exercise specific failure modes without mutating
 * shared state.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new EnvValidationError(issues, "explicit");
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Validates process.env at boot. On failure, prints a human-readable
 * error and exits with code 78 (EX_CONFIG, BSD sysexits convention).
 */
export function loadEnv(): Env {
  if (cached) return cached;
  try {
    cached = parseEnv(process.env);
    return cached;
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`\n${err.message}\n\n`);
      process.stderr.write("See .env.example for the full list of supported variables.\n");
      process.exit(78);
    }
    throw err;
  }
}

/** Test-only escape hatch — clears the memoized env for re-resolution. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}
