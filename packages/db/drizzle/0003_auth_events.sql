CREATE TYPE "public"."auth_event_kind" AS ENUM('login.success', 'login.failed', 'login.locked', 'lockout.cleared', 'logout', 'session.revoked', 'password.set', 'password.changed', 'password.reset.requested', 'password.reset.consumed', 'magic_link.requested', 'magic_link.consumed', 'magic_link.consumed.failed', 'totp.enrolled', 'totp.disabled', 'totp.recovery_used', 'user.invited', 'user.activated', 'user.suspended', 'user.unsuspended', 'user.role_changed', 'user.totp_required', 'bootstrap.first_admin');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "auth_event_kind" NOT NULL,
	"user_id" text,
	"actor_user_id" text,
	"ip" text,
	"user_agent" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_created_at_idx" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_user_idx" ON "auth_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_events_kind_idx" ON "auth_events" USING btree ("kind");