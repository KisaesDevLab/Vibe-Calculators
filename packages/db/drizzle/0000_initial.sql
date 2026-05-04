CREATE TABLE IF NOT EXISTS "_meta" (
	"schema_version" text PRIMARY KEY NOT NULL,
	"bootstrapped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
