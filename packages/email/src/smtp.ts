import nodemailer, { type Transporter } from "nodemailer";
import {
  EmailDeliveryError,
  type EmailProvider,
  type SendInput,
  type SendResult,
} from "./types.js";

/**
 * Phase 22.3 — SMTP provider via nodemailer.
 *
 * Defaults to STARTTLS on port 587 when `secure=false` (the typical
 * Mailgun/SendGrid/SES SMTP relay configuration). Use `secure=true`
 * for the legacy implicit-TLS port 465.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean | undefined;
  from: string;
}

export class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;

  constructor(private readonly cfg: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure ?? cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  async send(input: SendInput): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: input.from ?? this.cfg.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, "base64"),
          contentType: a.contentType,
        })),
        headers: input.metadata
          ? Object.fromEntries(Object.entries(input.metadata).map(([k, v]) => [`X-Vibe-${k}`, v]))
          : undefined,
      });
      return { messageId: info.messageId, provider: this.name };
    } catch (err) {
      throw new EmailDeliveryError(
        this.name,
        undefined,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
