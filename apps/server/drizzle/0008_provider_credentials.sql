CREATE TABLE "provider_credentials" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"last_four" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_user_id_provider_pk" PRIMARY KEY("user_id","provider"),
	CONSTRAINT "provider_credentials_provider_check" CHECK ("provider_credentials"."provider" IN ('anthropic', 'openrouter')),
	CONSTRAINT "provider_credentials_last_four_check" CHECK (char_length("provider_credentials"."last_four") = 4),
	CONSTRAINT "provider_credentials_encrypted_key_check" CHECK ("provider_credentials"."encrypted_key" LIKE 'v1.%')
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;