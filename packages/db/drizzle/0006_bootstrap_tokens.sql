CREATE TABLE IF NOT EXISTS "bootstrap_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
