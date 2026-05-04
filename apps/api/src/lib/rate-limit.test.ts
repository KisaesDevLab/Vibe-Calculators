import { describe, expect, it } from "vitest";
import { RATE_LIMIT_CONSTANTS, createRateLimiter, memoryStore } from "./rate-limit.js";

const IP = "10.0.0.42";
const EMAIL = "alice@example.com";

describe("rate limit constants (build plan §2.7)", () => {
  it("5 attempts per 15-minute window", () => {
    expect(RATE_LIMIT_CONSTANTS.ATTEMPT_LIMIT).toBe(5);
    expect(RATE_LIMIT_CONSTANTS.ATTEMPT_WINDOW_SECONDS).toBe(15 * 60);
  });

  it("first lockout = 15 minutes; ladder caps at 24 hours", () => {
    const ladder = RATE_LIMIT_CONSTANTS.LOCKOUT_LADDER_SECONDS;
    expect(ladder[0]).toBe(15 * 60);
    expect(ladder[ladder.length - 1]).toBe(24 * 60 * 60);
  });
});

describe("createRateLimiter", () => {
  function freshLimiter() {
    let now = 1_000_000_000_000;
    const store = memoryStore(() => now);
    const limiter = createRateLimiter(store);
    return {
      limiter,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("does not lock on the first four failures", async () => {
    const { limiter } = freshLimiter();
    for (let i = 0; i < 4; i++) {
      const r = await limiter.recordFailure(IP, EMAIL);
      expect(r.locked).toBe(false);
    }
  });

  it("locks on the fifth failure with the 15-minute first-tier duration", async () => {
    const { limiter } = freshLimiter();
    for (let i = 0; i < 4; i++) await limiter.recordFailure(IP, EMAIL);
    const r = await limiter.recordFailure(IP, EMAIL);
    expect(r.locked).toBe(true);
    if (r.locked) expect(r.retryAfterMs).toBeGreaterThanOrEqual(14 * 60 * 1000);
  });

  it("subsequent recordFailure during a lock returns the live retryAfterMs", async () => {
    const { limiter, advance } = freshLimiter();
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, EMAIL);
    advance(60 * 1000); // 1 min in
    const r = await limiter.recordFailure(IP, EMAIL);
    expect(r.locked).toBe(true);
    if (r.locked) expect(r.retryAfterMs).toBeLessThanOrEqual(14 * 60 * 1000);
  });

  it("escalates the lock duration on the second lockout (history-window aware)", async () => {
    const { limiter, advance } = freshLimiter();
    // First lockout
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, EMAIL);
    advance(15 * 60 * 1000 + 1000); // wait out the 15-min lock
    expect((await limiter.status(IP, EMAIL)).locked).toBe(false);
    // Second lockout — should be ≥30 min
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, EMAIL);
    const r = await limiter.recordFailure(IP, EMAIL);
    expect(r.locked).toBe(true);
    if (r.locked) expect(r.retryAfterMs).toBeGreaterThanOrEqual(29 * 60 * 1000);
  });

  it("clearOnSuccess resets the attempt counter but preserves history", async () => {
    const { limiter, advance } = freshLimiter();
    await limiter.recordFailure(IP, EMAIL);
    await limiter.recordFailure(IP, EMAIL);
    await limiter.clearOnSuccess(IP, EMAIL);
    // 4 fresh failures should NOT lock yet because counter reset...
    for (let i = 0; i < 4; i++) {
      expect((await limiter.recordFailure(IP, EMAIL)).locked).toBe(false);
    }
    // ...the 5th does (no prior lockouts in history).
    expect((await limiter.recordFailure(IP, EMAIL)).locked).toBe(true);
    advance(15 * 60 * 1000 + 1000);
    // Second lockout still escalates because history was preserved.
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, EMAIL);
    const r = await limiter.recordFailure(IP, EMAIL);
    if (r.locked) expect(r.retryAfterMs).toBeGreaterThanOrEqual(29 * 60 * 1000);
  });

  it("adminClear wipes attempts AND history (escalation reset)", async () => {
    const { limiter, advance } = freshLimiter();
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, EMAIL);
    await limiter.adminClear(IP, EMAIL);
    expect((await limiter.status(IP, EMAIL)).locked).toBe(false);
    // After admin-clear the next lockout should be the FIRST tier (15 min).
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, EMAIL);
    const r = await limiter.recordFailure(IP, EMAIL);
    expect(r.locked).toBe(true);
    if (r.locked) {
      expect(r.retryAfterMs).toBeGreaterThanOrEqual(14 * 60 * 1000);
      expect(r.retryAfterMs).toBeLessThanOrEqual(16 * 60 * 1000);
    }
    advance(0);
  });

  it("attempt counter expires after the 15-min window", async () => {
    const { limiter, advance } = freshLimiter();
    await limiter.recordFailure(IP, EMAIL);
    await limiter.recordFailure(IP, EMAIL);
    advance(16 * 60 * 1000); // window slides
    // Counter is gone — 4 more shouldn't lock.
    for (let i = 0; i < 4; i++) {
      expect((await limiter.recordFailure(IP, EMAIL)).locked).toBe(false);
    }
    expect((await limiter.recordFailure(IP, EMAIL)).locked).toBe(true);
  });

  it("scopes by (ip, email): different ip with same email is independent", async () => {
    const { limiter } = freshLimiter();
    for (let i = 0; i < 5; i++) await limiter.recordFailure("10.0.0.1", EMAIL);
    expect((await limiter.status("10.0.0.1", EMAIL)).locked).toBe(true);
    expect((await limiter.status("10.0.0.2", EMAIL)).locked).toBe(false);
  });

  it("scopes by (ip, email): same ip with different email is independent", async () => {
    const { limiter } = freshLimiter();
    for (let i = 0; i < 5; i++) await limiter.recordFailure(IP, "alice@example.com");
    expect((await limiter.status(IP, "alice@example.com")).locked).toBe(true);
    expect((await limiter.status(IP, "bob@example.com")).locked).toBe(false);
  });
});
