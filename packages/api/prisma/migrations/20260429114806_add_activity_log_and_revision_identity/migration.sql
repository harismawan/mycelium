-- AlterTable
ALTER TABLE "Revision" ADD COLUMN     "authType" TEXT,
ADD COLUMN     "apiKeyId" TEXT,
ADD COLUMN     "apiKeyName" TEXT;

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "apiKeyName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetResourceId" TEXT,
    "targetResourceSlug" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'success',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_action_idx" ON "ActivityLog"("userId", "action");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_apiKeyName_idx" ON "ActivityLog"("userId", "apiKeyName");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
