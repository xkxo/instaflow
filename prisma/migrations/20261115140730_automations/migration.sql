-- CreateEnum
CREATE TYPE "MediaScope" AS ENUM ('ANY', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "KeywordMode" AS ENUM ('ANY', 'KEYWORDS');

-- CreateEnum
CREATE TYPE "KeywordMatch" AS ENUM ('WHOLE_WORD', 'CONTAINS');

-- CreateEnum
CREATE TYPE "FlowStep" AS ENUM ('TRIGGERED', 'OPENING_SENT', 'FOLLOW_GATED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "FlowRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'FAILED');

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "mediaScope" "MediaScope" NOT NULL DEFAULT 'ANY',
    "mediaId" TEXT,
    "mediaPermalink" TEXT,
    "mediaThumbnailUrl" TEXT,
    "mediaCaption" TEXT,
    "mediaType" TEXT,
    "mediaProductType" TEXT,
    "keywordMode" "KeywordMode" NOT NULL DEFAULT 'KEYWORDS',
    "keywords" TEXT[],
    "keywordMatch" "KeywordMatch" NOT NULL DEFAULT 'WHOLE_WORD',
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publicReplies" TEXT[],
    "openingMessage" TEXT NOT NULL,
    "openingButton" TEXT NOT NULL,
    "followGateEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notFollowingMessage" TEXT,
    "notFollowingButton" TEXT,
    "maxFollowChecks" INTEGER NOT NULL DEFAULT 3,
    "deliveryMessage" TEXT NOT NULL,
    "deliveryCardTitle" TEXT NOT NULL,
    "deliveryUrl" TEXT NOT NULL,
    "deliveryButton" TEXT NOT NULL DEFAULT 'Open link',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followsMe" BOOLEAN,
    "followCheckedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "commentText" TEXT,
    "mediaId" TEXT,
    "currentStep" "FlowStep" NOT NULL DEFAULT 'TRIGGERED',
    "status" "FlowRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "followChecks" INTEGER NOT NULL DEFAULT 0,
    "publicReplyText" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publicRepliedAt" TIMESTAMP(3),
    "openingSentAt" TIMESTAMP(3),
    "followGatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Automation_active_mediaScope_mediaId_idx" ON "Automation"("active", "mediaScope", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_igsid_key" ON "Contact"("igsid");

-- CreateIndex
CREATE INDEX "FlowRun_contactId_status_idx" ON "FlowRun"("contactId", "status");

-- CreateIndex
CREATE INDEX "FlowRun_automationId_status_idx" ON "FlowRun"("automationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FlowRun_automationId_commentId_key" ON "FlowRun"("automationId", "commentId");

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
