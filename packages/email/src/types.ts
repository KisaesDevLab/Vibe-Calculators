/**
 * Phase 22.3 — pluggable email providers.
 *
 * The provider interface is intentionally narrow (one method) so
 * each impl owns its own auth + transport. The factory selects an
 * impl by `VIBE_EMAIL_PROVIDER` env (smtp | postmark | emailit).
 */

export interface SendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    /** Base64-encoded content. */
    content: string;
  }>;
  /** Optional per-message metadata for delivery tracking. */
  metadata?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  send(input: SendInput): Promise<SendResult>;
}

export class EmailDeliveryError extends Error {
  constructor(
    public readonly provider: string,
    public readonly statusCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
