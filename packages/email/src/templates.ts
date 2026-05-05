/**
 * Phase 22.6 — HTML email templates.
 *
 * Hand-written HTML rather than MJML-compiled — keeps the build
 * dependency surface small (mjml is ~75 MB) while delivering the
 * same outcome: structured, branded emails operators can hand to
 * external recipients.
 *
 * Each renderer returns `{ subject, text, html }`. Callers feed the
 * tuple into the configured email provider's `send()`. Plain-text
 * fallback is rendered alongside the HTML so spam filters don't
 * penalise the message.
 *
 * The HTML uses inline styles only (no <style> block) — most email
 * clients (notably Gmail, Outlook) strip <style>. Tables for layout
 * to keep older clients happy.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface FirmContext {
  firmName?: string | undefined;
  firmFooter?: string | undefined;
  brandColor?: string | undefined;
}

const DEFAULT_BRAND = "#2563eb";

function shellHtml(args: {
  title: string;
  preheader?: string;
  brand: FirmContext;
  body: string;
}): string {
  const brandColor = args.brand.brandColor ?? DEFAULT_BRAND;
  const firmName = args.brand.firmName ?? "Vibe Calculators";
  const firmFooter =
    args.brand.firmFooter ?? "Sent automatically — please don't reply to this address.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escape(args.title)}</title>
    <style>@media (prefers-color-scheme: dark) { body { background: #111 !important; color: #eee !important; } }</style>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;">
    ${args.preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:#f5f5f7;">${escape(args.preheader)}</div>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f7;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;max-width:560px;">
          <tr><td style="padding:20px 28px;border-bottom:3px solid ${brandColor};">
            <p style="margin:0;font-weight:600;font-size:14px;color:${brandColor};">${escape(firmName)}</p>
          </td></tr>
          <tr><td style="padding:24px 28px;">${args.body}</td></tr>
          <tr><td style="padding:16px 28px;border-top:1px solid #e5e7eb;color:#64748b;font-size:11px;">${escape(firmFooter)}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function button(href: string, label: string, brandColor: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${brandColor};">
    <a href="${escape(href)}" style="display:inline-block;padding:10px 18px;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;border-radius:6px;">${escape(label)}</a>
  </td></tr></table>`;
}

// ---------------------------------------------------------------------
// Template — Magic-link sign-in
// ---------------------------------------------------------------------

export function renderMagicLinkEmail(args: {
  consumeUrl: string;
  expiresAt: Date;
  brand?: FirmContext;
}): RenderedEmail {
  const brand = args.brand ?? {};
  const expires = args.expiresAt.toISOString();
  const subject = `Sign in to ${brand.firmName ?? "Vibe Calculators"}`;
  const text = `A sign-in link was requested for this address.\n\nOpen: ${args.consumeUrl}\n\nThis link expires at ${expires}. If you didn't request it, ignore this message.`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:18px;">Sign in</h1>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">A sign-in link was requested for this address. The link expires at <strong>${escape(expires)}</strong>.</p>
    ${button(args.consumeUrl, "Sign in", brand.brandColor ?? DEFAULT_BRAND)}
    <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">If the button doesn't work, copy and paste this URL: ${escape(args.consumeUrl)}</p>
    <p style="margin:12px 0 0 0;font-size:12px;color:#64748b;">If you didn't request this, ignore the message — no action needed.</p>`;
  return {
    subject,
    text,
    html: shellHtml({ title: subject, preheader: "Your sign-in link", brand, body }),
  };
}

// ---------------------------------------------------------------------
// Template — Account invitation
// ---------------------------------------------------------------------

export function renderAccountInvitationEmail(args: {
  recipientName: string;
  inviterName: string;
  consumeUrl: string;
  role: string;
  brand?: FirmContext;
}): RenderedEmail {
  const brand = args.brand ?? {};
  const subject = `${args.inviterName} invited you to ${brand.firmName ?? "Vibe Calculators"}`;
  const text = `${args.inviterName} invited you to ${brand.firmName ?? "Vibe Calculators"} as ${args.role}.\n\nAccept: ${args.consumeUrl}\n\nThe link expires in 24 hours.`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:18px;">You're invited</h1>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">${escape(args.inviterName)} invited you to <strong>${escape(brand.firmName ?? "Vibe Calculators")}</strong> as <em>${escape(args.role)}</em>. Click the button to set a password and finish account setup.</p>
    ${button(args.consumeUrl, "Accept invitation", brand.brandColor ?? DEFAULT_BRAND)}
    <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">The invitation link expires in 24 hours.</p>`;
  return {
    subject,
    text,
    html: shellHtml({
      title: subject,
      preheader: `Invited as ${args.role}`,
      brand,
      body,
    }),
  };
}

// ---------------------------------------------------------------------
// Template — Password reset
// ---------------------------------------------------------------------

export function renderPasswordResetEmail(args: {
  consumeUrl: string;
  expiresAt: Date;
  brand?: FirmContext;
}): RenderedEmail {
  const brand = args.brand ?? {};
  const subject = `Reset your ${brand.firmName ?? "Vibe Calculators"} password`;
  const text = `A password reset was requested for this address.\n\nReset: ${args.consumeUrl}\n\nThe link expires at ${args.expiresAt.toISOString()}. If you didn't request it, ignore this message.`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:18px;">Reset password</h1>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">A password reset was requested for this address. Click the button to choose a new password.</p>
    ${button(args.consumeUrl, "Reset password", brand.brandColor ?? DEFAULT_BRAND)}
    <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">The link expires at ${escape(args.expiresAt.toISOString())}.</p>
    <p style="margin:12px 0 0 0;font-size:12px;color:#64748b;">Didn't request this? Ignore the email — your password stays unchanged.</p>`;
  return {
    subject,
    text,
    html: shellHtml({ title: subject, preheader: "Password reset link inside", brand, body }),
  };
}

// ---------------------------------------------------------------------
// Template — Scheduled recompute summary (Phase 22.4)
// ---------------------------------------------------------------------

export function renderScheduledRecomputeEmail(args: {
  scheduleName: string;
  calcName: string;
  computedAt: Date;
  attachmentName?: string;
  brand?: FirmContext;
}): RenderedEmail {
  const brand = args.brand ?? {};
  const subject = `[${brand.firmName ?? "Vibe"}] ${args.scheduleName}: ${args.calcName} recomputed`;
  const text = `${args.calcName} was recomputed by the scheduled job "${args.scheduleName}" at ${args.computedAt.toISOString()}.${
    args.attachmentName ? `\n\nAttached: ${args.attachmentName}` : ""
  }`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:18px;">Scheduled recompute</h1>
    <p style="margin:0 0 8px 0;font-size:14px;">Calculation: <strong>${escape(args.calcName)}</strong></p>
    <p style="margin:0 0 8px 0;font-size:14px;">Schedule: <strong>${escape(args.scheduleName)}</strong></p>
    <p style="margin:0 0 16px 0;font-size:14px;">Computed at: ${escape(args.computedAt.toISOString())}</p>
    ${args.attachmentName ? `<p style="margin:0 0 0 0;font-size:13px;color:#64748b;">Attached: ${escape(args.attachmentName)}</p>` : ""}`;
  return {
    subject,
    text,
    html: shellHtml({ title: subject, brand, body }),
  };
}

// ---------------------------------------------------------------------
// Template — Review requested
// ---------------------------------------------------------------------

export function renderReviewRequestedEmail(args: {
  reviewerName: string;
  preparerName: string;
  calcName: string;
  reviewUrl: string;
  brand?: FirmContext;
}): RenderedEmail {
  const brand = args.brand ?? {};
  const subject = `Review requested: ${args.calcName}`;
  const text = `${args.preparerName} submitted "${args.calcName}" for review.\n\nOpen: ${args.reviewUrl}`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:18px;">Review requested</h1>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">${escape(args.preparerName)} submitted <strong>${escape(args.calcName)}</strong> and is asking ${escape(args.reviewerName)} to review.</p>
    ${button(args.reviewUrl, "Open review", brand.brandColor ?? DEFAULT_BRAND)}`;
  return {
    subject,
    text,
    html: shellHtml({ title: subject, brand, body }),
  };
}

// ---------------------------------------------------------------------
// Template — Comment mention
// ---------------------------------------------------------------------

export function renderCommentMentionEmail(args: {
  mentionedName: string;
  authorName: string;
  calcName: string;
  excerpt: string;
  url: string;
  brand?: FirmContext;
}): RenderedEmail {
  const brand = args.brand ?? {};
  const subject = `[${brand.firmName ?? "Vibe"}] ${args.authorName} mentioned you in ${args.calcName}`;
  const text = `${args.authorName} mentioned you in a comment on "${args.calcName}":\n\n${args.excerpt}\n\nOpen: ${args.url}`;
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:18px;">You were mentioned</h1>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;">${escape(args.authorName)} mentioned you in a comment on <strong>${escape(args.calcName)}</strong>:</p>
    <blockquote style="margin:0 0 16px 0;padding:8px 12px;border-left:3px solid ${brand.brandColor ?? DEFAULT_BRAND};background:#f8fafc;font-size:13px;color:#334155;">${escape(args.excerpt)}</blockquote>
    ${button(args.url, "Open comment", brand.brandColor ?? DEFAULT_BRAND)}`;
  return {
    subject,
    text,
    html: shellHtml({ title: subject, brand, body }),
  };
}
