CREATE TYPE "public"."client_entity_type" AS ENUM('individual', 'sole_prop', 'single_member_llc', 'multi_member_llc', 's_corp', 'c_corp', 'partnership', 'trust', 'estate', 'nonprofit', 'other');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('draft', 'in_review', 'approved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."engagement_type" AS ENUM('tax_planning', 'tax_prep', 'advisory', 'loan_modeling', 'audit_support', 'other');--> statement-breakpoint
CREATE TYPE "public"."calculation_kind" AS ENUM('tvm.amortization', 'tvm.bond', 'tvm.lease_842', 'tvm.tdr', 'tvm.imputed_interest', 'tvm.below_market_loan', 'tvm.sinking_fund', 'tvm.lease_factor', 'tvm.note_yield', 'tvm.irr_npv', 'tvm.cash_flow_event_grid', 'tax.macrs', 'tax.section_179', 'tax.bonus_depreciation', 'tax.depreciation_combined', 'tax.cost_seg', 'tax.rmd', 'tax.roth_conversion', 'tax.capital_gains', 'tax.qbi', 'tax.safe_harbor', 'tax.se_tax', 'tax.state_estimate', 'tax.amt', 'tax.section_1031', 'tax.installment_sale', 'tax.section_121', 'tax.irs_interest_penalty', 'tax.hsa', 'tax.qualified_plan', 'tax.social_security_age', 'other');--> statement-breakpoint
CREATE TYPE "public"."calculation_status" AS ENUM('draft', 'ready_for_review', 'approved');--> statement-breakpoint
CREATE TYPE "public"."tagged_entity_kind" AS ENUM('client', 'engagement', 'calculation');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"entity_type" "client_entity_type" DEFAULT 'individual' NOT NULL,
	"ein" text,
	"address_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_contact_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"tax_year" integer,
	"engagement_type" "engagement_type" DEFAULT 'advisory' NOT NULL,
	"status" "engagement_status" DEFAULT 'draft' NOT NULL,
	"assigned_preparer_id" text,
	"assigned_reviewer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calculation_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calculation_id" text NOT NULL,
	"version" integer NOT NULL,
	"inputs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"computed_at" timestamp with time zone,
	"computed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calculations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" text,
	"client_id" text,
	"kind" "calculation_kind" NOT NULL,
	"name" text NOT NULL,
	"inputs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone,
	"computed_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_id" text,
	"current_version_id" text,
	"status" "calculation_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_tags" (
	"tag_id" text NOT NULL,
	"entity_kind" "tagged_entity_kind" NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "engagements" ADD CONSTRAINT "engagements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "engagements" ADD CONSTRAINT "engagements_assigned_preparer_id_users_id_fk" FOREIGN KEY ("assigned_preparer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "engagements" ADD CONSTRAINT "engagements_assigned_reviewer_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculation_versions" ADD CONSTRAINT "calculation_versions_calculation_id_calculations_id_fk" FOREIGN KEY ("calculation_id") REFERENCES "public"."calculations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculation_versions" ADD CONSTRAINT "calculation_versions_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculation_versions" ADD CONSTRAINT "calculation_versions_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculations" ADD CONSTRAINT "calculations_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculations" ADD CONSTRAINT "calculations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculations" ADD CONSTRAINT "calculations_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calculations" ADD CONSTRAINT "calculations_parent_id_calculations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."calculations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_name_idx" ON "clients" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_archived_idx" ON "clients" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_client_idx" ON "engagements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_status_idx" ON "engagements" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_name_idx" ON "engagements" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_archived_idx" ON "engagements" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calc_versions_calc_idx" ON "calculation_versions" USING btree ("calculation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calc_versions_calc_version_idx" ON "calculation_versions" USING btree ("calculation_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_engagement_idx" ON "calculations" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_client_idx" ON "calculations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_kind_idx" ON "calculations" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_status_idx" ON "calculations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_name_idx" ON "calculations" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_parent_idx" ON "calculations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calculations_archived_idx" ON "calculations" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_tags_pk" ON "entity_tags" USING btree ("tag_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_tags_entity_idx" ON "entity_tags" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_name_unique" ON "tags" USING btree ("name");