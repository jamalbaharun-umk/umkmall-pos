CREATE TABLE "pos"."handoff_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."handoff_jtis" ENABLE ROW LEVEL SECURITY;