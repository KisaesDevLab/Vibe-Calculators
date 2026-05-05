-- M15 — TOTP code reuse counter.
--
-- Persisting the last accepted step counter on the user row lets
-- verifyTotp reject a replayed code within its 30s window. NULL =
-- never used; the first successful verify will set it.

ALTER TABLE "users" ADD COLUMN "totp_last_counter" bigint;
