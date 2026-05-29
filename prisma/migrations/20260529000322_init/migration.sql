-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "internal_code" TEXT,
    "clinical_profile" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "user_id" UUID,
    "note_text" TEXT,
    "session_date" TEXT,
    "behaviors_addressed" TEXT[],
    "skills_addressed" TEXT[],
    "interventions_used" TEXT[],
    "activities_used" TEXT[],
    "review_status" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_comment" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan" TEXT,
    "status" TEXT,
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_ends_at" TIMESTAMPTZ(6),
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "bcba_students_status" TEXT,
    "bcba_students_trial_ends_at" TIMESTAMPTZ(6),
    "bcba_students_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bcba_clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bcba_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "rbt_id" UUID,
    "connected_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bcba_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fieldwork_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_date" TEXT NOT NULL,
    "month_year" TEXT NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "independent_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supervised_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activity_type" TEXT,
    "contact_type" TEXT DEFAULT 'none',
    "setting" TEXT,
    "supervisor_name" TEXT,
    "session_note" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fieldwork_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fieldwork_monthly_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "month_year" TEXT NOT NULL,
    "total_independent_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_supervised_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supervision_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrestricted_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "restricted_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supervisor_contacts" INTEGER NOT NULL DEFAULT 0,
    "individual_contacts" INTEGER NOT NULL DEFAULT 0,
    "group_contacts" INTEGER NOT NULL DEFAULT 0,
    "client_observations" INTEGER NOT NULL DEFAULT 0,
    "is_eligible" BOOLEAN NOT NULL DEFAULT false,
    "ineligibility_reason" TEXT,
    "mvf_signed" BOOLEAN NOT NULL DEFAULT false,
    "mvf_signed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fieldwork_monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fieldwork_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "fieldwork_type" TEXT,
    "certification_track" TEXT,
    "trainee_bacb_id" TEXT,
    "supervisor_name" TEXT,
    "supervisor_bacb_id" TEXT,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fieldwork_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_access_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "rbt_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "used" BOOLEAN NOT NULL DEFAULT false,
    "used_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervision_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "bcba_id" UUID,
    "rbt_id" UUID,
    "session_date" TEXT,
    "supervision_type" TEXT,
    "note_text" TEXT,
    "status" TEXT DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervision_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_training_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "bcba_id" UUID,
    "session_date" TEXT,
    "caregiver_name" TEXT,
    "caregiver_relation" TEXT,
    "note_text" TEXT,
    "status" TEXT DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_training_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missed_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "rbt_id" UUID,
    "date" TEXT,
    "reason" TEXT,
    "hours" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "missed_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behaviors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behaviors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topographies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "behavior_id" UUID NOT NULL,
    "description" TEXT,
    "measurable_unit" TEXT,
    "severity_level" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topographies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervision_notes_97153xp" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "bcba_id" UUID,
    "session_date" TEXT,
    "note_text" TEXT,
    "rbt_session_context" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervision_notes_97153xp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replacement_skills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "skill_description" TEXT,
    "function_targeted" TEXT,
    "behavior_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "discount_amount" DOUBLE PRECISION,
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bcba_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note" TEXT,
    "category" TEXT,
    "activity_type" TEXT,

    CONSTRAINT "bcba_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'rbt',
    "emailVerified" TIMESTAMPTZ(6),
    "image" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bcba_clients_bcba_id_client_id_key" ON "bcba_clients"("bcba_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "fieldwork_monthly_summaries_user_id_month_year_key" ON "fieldwork_monthly_summaries"("user_id", "month_year");

-- CreateIndex
CREATE UNIQUE INDEX "fieldwork_profiles_user_id_key" ON "fieldwork_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_access_codes_code_key" ON "client_access_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bcba_clients" ADD CONSTRAINT "bcba_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_access_codes" ADD CONSTRAINT "client_access_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervision_notes" ADD CONSTRAINT "supervision_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_training_notes" ADD CONSTRAINT "parent_training_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missed_hours" ADD CONSTRAINT "missed_hours_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topographies" ADD CONSTRAINT "topographies_behavior_id_fkey" FOREIGN KEY ("behavior_id") REFERENCES "behaviors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervision_notes_97153xp" ADD CONSTRAINT "supervision_notes_97153xp_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replacement_skills" ADD CONSTRAINT "replacement_skills_behavior_id_fkey" FOREIGN KEY ("behavior_id") REFERENCES "behaviors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
