-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'wikilink',
ADD COLUMN     "weight" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Link_fromId_source_idx" ON "Link"("fromId", "source");
