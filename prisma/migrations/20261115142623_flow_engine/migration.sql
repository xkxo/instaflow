-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "FlowStep_new" AS ENUM ('TRIGGERED', 'AWAITING_OPT_IN', 'AWAITING_FOLLOW', 'DELIVERING', 'DELIVERED');
ALTER TABLE "public"."FlowRun" ALTER COLUMN "currentStep" DROP DEFAULT;
-- Map renamed steps: OPENING_SENT → AWAITING_OPT_IN, FOLLOW_GATED → AWAITING_FOLLOW.
ALTER TABLE "FlowRun" ALTER COLUMN "currentStep" TYPE "FlowStep_new" USING (
  CASE "currentStep"::text
    WHEN 'OPENING_SENT' THEN 'AWAITING_OPT_IN'
    WHEN 'FOLLOW_GATED' THEN 'AWAITING_FOLLOW'
    ELSE "currentStep"::text
  END
)::"FlowStep_new";
ALTER TYPE "FlowStep" RENAME TO "FlowStep_old";
ALTER TYPE "FlowStep_new" RENAME TO "FlowStep";
DROP TYPE "public"."FlowStep_old";
ALTER TABLE "FlowRun" ALTER COLUMN "currentStep" SET DEFAULT 'TRIGGERED';
COMMIT;

-- DropIndex
DROP INDEX "FlowRun_automationId_commentId_key";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FlowRun" ADD COLUMN     "commentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dryRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matchedKeyword" TEXT,
ADD COLUMN     "optedInAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FlowRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "FlowRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "key" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowRunEvent_runId_at_idx" ON "FlowRunEvent"("runId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Job_key_key" ON "Job"("key");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Contact_lastSeenAt_idx" ON "Contact"("lastSeenAt");

-- CreateIndex
CREATE INDEX "FlowRun_commentId_idx" ON "FlowRun"("commentId");

-- CreateIndex
CREATE INDEX "FlowRun_startedAt_idx" ON "FlowRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowRun_automationId_contactId_key" ON "FlowRun"("automationId", "contactId");

-- AddForeignKey
ALTER TABLE "FlowRunEvent" ADD CONSTRAINT "FlowRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

