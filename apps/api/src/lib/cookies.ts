import type { Response } from "express";
import { ABSOLUTE_TTL_MS, ROLLING_TTL_MS, SESSION_COOKIE_NAME } from "./sessions.js";

/**
 * Phase 2.4 — session cookie helpers.
 *
 * The cookie carries the opaque session ID. Attributes:
 *   - HttpOnly: true (no JS access ever)
 *   - Secure:   only when VIBE_DEPLOY_MODE === 'domain'
 *               (lan + tailscale modes serve plaintext)
 *   - SameSite: Lax (build plan §2.4)
 *   - Path:     /
 *   - Max-Age:  rolling TTL
 */

export interface SessionCookieOptions {
  deployMode: "lan" | "domain" | "tailscale";
}

export function setSessionCookie(
  res: Response,
  sessionId: string,
  opts: SessionCookieOptions,
): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: opts.deployMode === "domain",
    sameSite: "lax",
    path: "/",
    maxAge: ROLLING_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, opts: SessionCookieOptions): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: opts.deployMode === "domain",
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Refresh the cookie's Max-Age every time we extend a session so the
 * browser-side expiration stays in sync with the DB rolling window.
 */
export function refreshSessionCookie(
  res: Response,
  sessionId: string,
  opts: SessionCookieOptions,
): void {
  setSessionCookie(res, sessionId, opts);
}

export const SESSION_COOKIE_TTL_MS = ROLLING_TTL_MS;
export const SESSION_ABSOLUTE_TTL_MS = ABSOLUTE_TTL_MS;
export { SESSION_COOKIE_NAME };
