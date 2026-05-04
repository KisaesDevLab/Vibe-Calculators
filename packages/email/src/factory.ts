import { z } from "zod";
import { SmtpProvider } from "./smtp.js";
import { PostmarkProvider } from "./postmark.js";
import { EmailItProvider } from "./emailit.js";
import type { EmailProvider } from "./types.js";

/**
 * Phase 22.3 — provider factory.
 *
 * Reads the requested provider name + a free-form config bag and
 * returns a typed `EmailProvider`. Unrecognized providers throw
 * with a clear message.
 *
 * The factory deliberately validates each provider's config shape
 * via Zod so a misconfigured deployment fails at startup, not on
 * first email send.
 */

const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65_535),
  user: z.string().min(1),
  pass: z.string().min(1),
  secure: z.coerce.boolean().optional(),
  from: z.string().email(),
});

const postmarkConfigSchema = z.object({
  serverToken: z.string().min(1),
  from: z.string().email(),
  messageStream: z.string().min(1).optional(),
});

const emailItConfigSchema = z.object({
  apiKey: z.string().min(1),
  from: z.string().email(),
  endpoint: z.string().url().optional(),
});

export type ProviderName = "smtp" | "postmark" | "emailit";

export interface FactoryInput {
  provider: ProviderName | string;
  smtp?: Partial<z.infer<typeof smtpConfigSchema>>;
  postmark?: Partial<z.infer<typeof postmarkConfigSchema>>;
  emailit?: Partial<z.infer<typeof emailItConfigSchema>>;
}

export function createEmailProvider(input: FactoryInput): EmailProvider {
  if (input.provider === "smtp") {
    const cfg = smtpConfigSchema.parse(input.smtp ?? {});
    return new SmtpProvider(cfg);
  }
  if (input.provider === "postmark") {
    const cfg = postmarkConfigSchema.parse(input.postmark ?? {});
    return new PostmarkProvider(cfg);
  }
  if (input.provider === "emailit") {
    const cfg = emailItConfigSchema.parse(input.emailit ?? {});
    return new EmailItProvider(cfg);
  }
  throw new Error(
    `Unknown VIBE_EMAIL_PROVIDER: ${input.provider} (expected smtp|postmark|emailit)`,
  );
}

/**
 * Build a provider directly from `process.env`-shaped input. The
 * Phase 1 env validator wraps this so misconfiguration surfaces as
 * an EX_CONFIG exit, not a runtime error.
 */
export function createEmailProviderFromEnv(env: Record<string, string | undefined>): EmailProvider {
  const provider = env.VIBE_EMAIL_PROVIDER ?? "smtp";
  return createEmailProvider({
    provider,
    smtp: {
      ...(env.SMTP_HOST !== undefined ? { host: env.SMTP_HOST } : {}),
      ...(env.SMTP_PORT !== undefined ? { port: Number(env.SMTP_PORT) } : {}),
      ...(env.SMTP_USER !== undefined ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASS !== undefined ? { pass: env.SMTP_PASS } : {}),
      ...(env.SMTP_SECURE !== undefined ? { secure: env.SMTP_SECURE === "true" } : {}),
      ...(env.SMTP_FROM !== undefined ? { from: env.SMTP_FROM } : {}),
    },
    postmark: {
      ...(env.POSTMARK_SERVER_TOKEN !== undefined
        ? { serverToken: env.POSTMARK_SERVER_TOKEN }
        : {}),
      ...(env.POSTMARK_FROM !== undefined ? { from: env.POSTMARK_FROM } : {}),
      ...(env.POSTMARK_STREAM !== undefined ? { messageStream: env.POSTMARK_STREAM } : {}),
    },
    emailit: {
      ...(env.EMAILIT_API_KEY !== undefined ? { apiKey: env.EMAILIT_API_KEY } : {}),
      ...(env.EMAILIT_FROM !== undefined ? { from: env.EMAILIT_FROM } : {}),
      ...(env.EMAILIT_ENDPOINT !== undefined ? { endpoint: env.EMAILIT_ENDPOINT } : {}),
    },
  });
}
