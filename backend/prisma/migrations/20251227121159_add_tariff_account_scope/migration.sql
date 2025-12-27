-- AlterTable
ALTER TABLE "Tariff" ADD COLUMN     "accountId" INTEGER;

-- CreateIndex
CREATE INDEX "Tariff_accountId_idx" ON "Tariff"("accountId");

-- AddForeignKey
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
