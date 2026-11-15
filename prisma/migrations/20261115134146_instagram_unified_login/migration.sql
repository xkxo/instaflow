-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('VALID', 'INVALID');

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "profilePictureUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "clientBusinessId" TEXT,
    "systemUserId" TEXT,
    "configId" TEXT NOT NULL,
    "tokenStatus" "TokenStatus" NOT NULL DEFAULT 'VALID',
    "tokenStatusReason" TEXT,
    "tokenCheckedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_igAccountId_key" ON "InstagramAccount"("igAccountId");
