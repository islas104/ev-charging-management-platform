/*
  Warnings:

  - A unique constraint covering the columns `[ocppTransactionId]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ocppTransactionId` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "ocppTransactionId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_ocppTransactionId_key" ON "Transaction"("ocppTransactionId");
