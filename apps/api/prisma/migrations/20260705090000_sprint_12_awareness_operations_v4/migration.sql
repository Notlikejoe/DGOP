-- Sprint 12 v4: Awareness Operations expansion.
CREATE TYPE "TrainingTier" AS ENUM ('tier_1', 'tier_2', 'tier_3', 'tier_4');
CREATE TYPE "CertificationLevel" AS ENUM ('cds', 'sds', 'mds');
CREATE TYPE "CertificationAttemptStatus" AS ENUM ('in_progress', 'passed', 'failed', 'expired', 'revoked');
CREATE TYPE "MentorshipStatus" AS ENUM ('planned', 'active', 'completed', 'cancelled');

ALTER TABLE "training_courses"
  ADD COLUMN "tier" "TrainingTier" NOT NULL DEFAULT 'tier_1',
  ADD COLUMN "deliveryMethod" TEXT NOT NULL DEFAULT 'self_paced',
  ADD COLUMN "prerequisiteCourseId" TEXT;

CREATE INDEX "training_courses_tier_idx" ON "training_courses"("tier");
CREATE INDEX "training_courses_prerequisiteCourseId_idx" ON "training_courses"("prerequisiteCourseId");

ALTER TABLE "training_courses"
  ADD CONSTRAINT "training_courses_prerequisiteCourseId_fkey"
  FOREIGN KEY ("prerequisiteCourseId") REFERENCES "training_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "certification_tracks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "level" "CertificationLevel" NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "requiredTier" "TrainingTier" NOT NULL DEFAULT 'tier_1',
    "requiredCeHours" INTEGER NOT NULL DEFAULT 0,
    "validityMonths" INTEGER NOT NULL DEFAULT 24,
    "passScore" INTEGER NOT NULL DEFAULT 80,
    "privileges" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certification_tracks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "certification_attempts" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "status" "CertificationAttemptStatus" NOT NULL DEFAULT 'in_progress',
    "examScore" INTEGER,
    "caseStudyScore" INTEGER,
    "peerReviewScore" INTEGER,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "renewalDueAt" TIMESTAMP(3),
    "evidenceNote" TEXT,
    "assessor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certification_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "continuing_education_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT,
    "activityType" TEXT NOT NULL DEFAULT 'course',
    "hours" INTEGER NOT NULL,
    "activityDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceNote" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "continuing_education_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_articles" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "summaryEn" TEXT,
    "summaryAr" TEXT,
    "content" TEXT,
    "category" TEXT NOT NULL DEFAULT 'best_practice',
    "status" TEXT NOT NULL DEFAULT 'published',
    "authorPersonId" TEXT,
    "contributionPoints" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_articles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expert_profiles" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "expertiseArea" TEXT NOT NULL,
    "bio" TEXT,
    "contributionPoints" INTEGER NOT NULL DEFAULT 0,
    "mentorshipCapacity" INTEGER NOT NULL DEFAULT 1,
    "isMentor" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expert_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mentorship_pairs" (
    "id" TEXT NOT NULL,
    "mentorPersonId" TEXT NOT NULL,
    "menteePersonId" TEXT NOT NULL,
    "status" "MentorshipStatus" NOT NULL DEFAULT 'planned',
    "focusArea" TEXT,
    "startDate" TIMESTAMP(3),
    "targetEndDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progressNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentorship_pairs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "certification_tracks_code_key" ON "certification_tracks"("code");
CREATE INDEX "certification_tracks_level_idx" ON "certification_tracks"("level");
CREATE INDEX "certification_tracks_requiredTier_idx" ON "certification_tracks"("requiredTier");
CREATE INDEX "certification_tracks_isActive_idx" ON "certification_tracks"("isActive");
CREATE INDEX "certification_attempts_trackId_idx" ON "certification_attempts"("trackId");
CREATE INDEX "certification_attempts_userId_status_idx" ON "certification_attempts"("userId", "status");
CREATE INDEX "certification_attempts_personId_idx" ON "certification_attempts"("personId");
CREATE INDEX "certification_attempts_expiresAt_idx" ON "certification_attempts"("expiresAt");
CREATE INDEX "continuing_education_activities_userId_idx" ON "continuing_education_activities"("userId");
CREATE INDEX "continuing_education_activities_personId_idx" ON "continuing_education_activities"("personId");
CREATE INDEX "continuing_education_activities_activityDate_idx" ON "continuing_education_activities"("activityDate");
CREATE INDEX "community_articles_category_idx" ON "community_articles"("category");
CREATE INDEX "community_articles_status_idx" ON "community_articles"("status");
CREATE INDEX "community_articles_authorPersonId_idx" ON "community_articles"("authorPersonId");
CREATE UNIQUE INDEX "expert_profiles_personId_key" ON "expert_profiles"("personId");
CREATE INDEX "expert_profiles_isActive_idx" ON "expert_profiles"("isActive");
CREATE INDEX "mentorship_pairs_mentorPersonId_idx" ON "mentorship_pairs"("mentorPersonId");
CREATE INDEX "mentorship_pairs_menteePersonId_idx" ON "mentorship_pairs"("menteePersonId");
CREATE INDEX "mentorship_pairs_status_idx" ON "mentorship_pairs"("status");

ALTER TABLE "certification_attempts" ADD CONSTRAINT "certification_attempts_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "certification_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "certification_attempts" ADD CONSTRAINT "certification_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "certification_attempts" ADD CONSTRAINT "certification_attempts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "continuing_education_activities" ADD CONSTRAINT "continuing_education_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "continuing_education_activities" ADD CONSTRAINT "continuing_education_activities_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_articles" ADD CONSTRAINT "community_articles_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mentorship_pairs" ADD CONSTRAINT "mentorship_pairs_mentorPersonId_fkey" FOREIGN KEY ("mentorPersonId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mentorship_pairs" ADD CONSTRAINT "mentorship_pairs_menteePersonId_fkey" FOREIGN KEY ("menteePersonId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
