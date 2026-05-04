CREATE TYPE "public"."tax_table_kind" AS ENUM('federal_tax_brackets', 'standard_deduction', 'alternative_minimum_tax_exemption', 'fica_wage_base', 'medicare_thresholds', 'niit_thresholds', 'qbi_thresholds', 'section_179_limits', 'bonus_depreciation_pct', 'macrs_tables', 'rmd_uniform_lifetime', 'rmd_joint_life', 'rmd_single_life', 'retirement_contribution_limits', 'social_security_wage_base', 'ss_optimal_age_table', 'hsa_contribution_limits', 'afr_short_mid_long');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_year_overrides" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_year" integer NOT NULL,
	"kind" "tax_table_kind" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"source_url" text,
	"source_version" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_year_tables" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_year" integer NOT NULL,
	"kind" "tax_table_kind" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"source_url" text,
	"source_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tax_year_overrides_key_idx" ON "tax_year_overrides" USING btree ("tax_year","kind","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_year_tables_year_kind_idx" ON "tax_year_tables" USING btree ("tax_year","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_year_tables_eff_from_idx" ON "tax_year_tables" USING btree ("effective_from");