/*
  Warnings:

  - A unique constraint covering the columns `[accountId,externalId]` on the table `Location` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Location_accountId_externalId_key" ON "Location"("accountId", "externalId");
