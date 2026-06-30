-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "importance" INTEGER,
ADD COLUMN     "source" TEXT;
