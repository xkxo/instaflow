-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "webhookCheckedAt" TIMESTAMP(3),
ADD COLUMN     "webhookError" TEXT,
ADD COLUMN     "webhookFields" TEXT[];

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "igAccountId" TEXT,
    "senderId" TEXT,
    "senderUsername" TEXT,
    "text" TEXT,
    "actionPayload" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryCount" INTEGER NOT NULL DEFAULT 1,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "ignoredReason" TEXT,
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_idempotencyKey_key" ON "WebhookEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processed_receivedAt_idx" ON "WebhookEvent"("processed", "receivedAt");
