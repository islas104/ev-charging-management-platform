-- DropForeignKey
ALTER TABLE "Charger" DROP CONSTRAINT "Charger_siteId_fkey";

-- AlterTable
ALTER TABLE "Charger" ALTER COLUMN "siteId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Charger" ADD CONSTRAINT "Charger_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
