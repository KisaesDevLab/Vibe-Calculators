import {
  EmailDeliveryError,
  type EmailProvider,
  type SendInput,
  type SendResult,
} from "./types.js";

/**
 * Phase 22.3 — Postmark API provider.
 *
 * Uses the bare Postmark `/email` endpoint via fetch — no SDK
 * dependency. Requires `serverToken` (per-server Postmark token).
 */

export interface PostmarkConfig {
  serverToken: string;
  from: string;
  /** Optional message-stream override; default "outbound". */
  messageStream?: string | undefined;
}

interface PostmarkResponse {
  MessageID: string;
  ErrorCode?: number;
  Message?: string;
}

export class PostmarkProvider implements EmailProvider {
  readonly name = "postmark";

  constructor(private readonly cfg: PostmarkConfig) {}

  async send(input: SendInput): Promise<SendResult> {
    const body: Record<string, unknown> = {
      From: input.from ?? this.cfg.from,
      To: input.to,
      Subject: input.subject,
      TextBody: input.text,
      MessageStream: this.cfg.messageStream ?? "outbound",
    };
    if (input.html) body.HtmlBody = input.html;
    if (input.attachments?.length) {
      body.Attachments = input.attachments.map((a) => ({
        Name: a.filename,
        Content: a.content,
        ContentType: a.contentType,
      }));
    }
    if (input.metadata) body.Metadata = input.metadata;

    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.cfg.serverToken,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as PostmarkResponse;
    if (!res.ok || (typeof json.ErrorCode === "number" && json.ErrorCode !== 0)) {
      throw new EmailDeliveryError(this.name, res.status, json.Message ?? "Postmark error");
    }
    return { messageId: json.MessageID, provider: this.name };
  }
}
