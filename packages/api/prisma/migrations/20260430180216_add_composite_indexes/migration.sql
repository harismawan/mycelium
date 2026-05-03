-- CreateIndex
CREATE INDEX "Note_userId_status_createdAt_idx" ON "Note"("userId", "status", "createdAt");
