import { describe, expect, it } from "vitest";
import { createEmailProvider, createEmailProviderFromEnv } from "./factory.js";

describe("email factory", () => {
  it("creates an SMTP provider with valid config", () => {
    const p = createEmailProvider({
      provider: "smtp",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        user: "u",
        pass: "p",
        from: "noreply@firm.test",
      },
    });
    expect(p.name).toBe("smtp");
  });

  it("creates a Postmark provider", () => {
    const p = createEmailProvider({
      provider: "postmark",
      postmark: { serverToken: "xxx", from: "noreply@firm.test" },
    });
    expect(p.name).toBe("postmark");
  });

  it("creates an EmailIt provider", () => {
    const p = createEmailProvider({
      provider: "emailit",
      emailit: { apiKey: "xxx", from: "noreply@firm.test" },
    });
    expect(p.name).toBe("emailit");
  });

  it("rejects unknown provider name", () => {
    expect(() => createEmailProvider({ provider: "mailgun" as never })).toThrow(
      /Unknown VIBE_EMAIL_PROVIDER/,
    );
  });

  it("rejects misconfigured SMTP via Zod", () => {
    expect(() => createEmailProvider({ provider: "smtp", smtp: { host: "" } })).toThrow();
  });

  it("createEmailProviderFromEnv reads SMTP_* vars", () => {
    const p = createEmailProviderFromEnv({
      VIBE_EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "n@firm.test",
    });
    expect(p.name).toBe("smtp");
  });
});
