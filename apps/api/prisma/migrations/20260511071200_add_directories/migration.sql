-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "directoryId" TEXT;

-- CreateTable
CREATE TABLE "Directory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Directory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Directory_userId_idx" ON "Directory"("userId");

-- CreateIndex
CREATE INDEX "Directory_parentId_idx" ON "Directory"("parentId");

-- CreateIndex
CREATE INDEX "Directory_userId_parentId_idx" ON "Directory"("userId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Directory_userId_parentId_name_key" ON "Directory"("userId", "parentId", "name");

-- CreateIndex
CREATE INDEX "Note_userId_directoryId_idx" ON "Note"("userId", "directoryId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "Directory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Directory" ADD CONSTRAINT "Directory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Directory" ADD CONSTRAINT "Directory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Directory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

