/*
  Warnings:

  - You are about to drop the column `searchVector` on the `Note` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Note_searchVector_idx";

-- AlterTable
ALTER TABLE "Note" DROP COLUMN "searchVector";
