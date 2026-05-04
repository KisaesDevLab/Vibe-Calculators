import {
  EmailDeliveryError,
  type EmailProvider,
  type SendInput,
  type SendResult,
} from "./types.js";

/**
 * Phase 22.3 — EmailIt API provider.
 *
 * EmailIt is a low-cost transactional email service whose API is
 * intentionally close to Postmark's shape: POST JSON, bearer-token
 * auth, MessageID in the response. Endpoint defaults to the
 * documented production URL but can be overridden for staging /
 * self-hosted forks.
 */

export interface EmailItConfig {
  apiKey: string;
  from: string;
  /** Override for staging or alternate endpoints. */
  endpoint?: string | undefined;
}

interface EmailItResponse {
  id?: string;
  message_id?: string;
  error?: { message?: string; code?: string };
}

const DEFAULT_ENDPOINT = "https://api.emailit.com/v1/emails";

export class EmailItProvider implements EmailProvider {
  readonly name = "emailit";

  constructor(private readonly cfg: EmailItConfig) {}

  async send(input: SendInput): Promise<SendResult> {
    const body: Record<string, unknown> = {
      from: input.from ?? this.cfg.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    };
    if (input.html) body.html = input.html;
    if (input.attachments?.length) {
      body.attachments = input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
      }));
    }
    if (input.metadata) body.metadata = input.metadata;

    const res = await fetch(this.cfg.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as EmailItResponse;
    if (!res.ok) {
      throw new EmailDeliveryError(this.name, res.status, json.error?.message ?? "EmailIt error");
    }
    const messageId = json.id ?? json.message_id;
    if (!messageId) {
      throw new EmailDeliveryError(this.name, res.status, "EmailIt response missing message id");
    }
    return { messageId, provider: this.name };
  }
}
