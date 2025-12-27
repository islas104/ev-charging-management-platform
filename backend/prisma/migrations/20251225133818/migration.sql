/*
  Warnings:

  - You are about to drop the column `siteId` on the `Charger` table. All the data in the column will be lost.
  - You are about to drop the `Site` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('OWNER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "LocationAccess" AS ENUM ('PUBLIC', 'PRIVATE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "LocationVisibility" AS ENUM ('LISTED', 'UNLISTED');

-- DropForeignKey
ALTER TABLE "Charger" DROP CONSTRAINT "Charger_siteId_fkey";

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "accountId" INTEGER;

-- AlterTable
ALTER TABLE "Charger" DROP COLUMN "siteId",
ADD COLUMN     "locationId" INTEGER;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "accountId" INTEGER;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "driverGroupId" INTEGER,
ADD COLUMN     "driverId" INTEGER,
ADD COLUMN     "energyFee" DECIMAL(10,4),
ADD COLUMN     "idleFee" DECIMAL(10,4),
ADD COLUMN     "locationId" INTEGER,
ADD COLUMN     "startFee" DECIMAL(10,4),
ADD COLUMN     "vatRate" DECIMAL(5,4);

-- DropTable
DROP TABLE "Site";

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL DEFAULT 'OWNER',
    "email" TEXT,
    "vatNumber" TEXT,
    "invoiceEmail" TEXT,
    "alertEmail" TEXT,
    "bankName" TEXT,
    "bankIban" TEXT,
    "bankBic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" SERIAL NOT NULL,
    "operatorAccountId" INTEGER NOT NULL,
    "ownerAccountId" INTEGER NOT NULL,
    "serviceFeePercent" DECIMAL(5,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "operatorAccountId" INTEGER,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "access" "LocationAccess" NOT NULL DEFAULT 'PUBLIC',
    "visibility" "LocationVisibility" NOT NULL DEFAULT 'LISTED',
    "tariffId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverGroup" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverGroupMember" (
    "id" SERIAL NOT NULL,
    "driverId" INTEGER NOT NULL,
    "driverGroupId" INTEGER NOT NULL,

    CONSTRAINT "DriverGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startFee" DECIMAL(10,4) NOT NULL,
    "energyFee" DECIMAL(10,4) NOT NULL,
    "idleFee" DECIMAL(10,4) NOT NULL,
    "vatRate" DECIMAL(5,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverGroupTariff" (
    "id" SERIAL NOT NULL,
    "driverGroupId" INTEGER NOT NULL,
    "tariffId" INTEGER NOT NULL,

    CONSTRAINT "DriverGroupTariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locationId" INTEGER NOT NULL,
    "chargerId" INTEGER,
    "connectorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_operatorAccountId_ownerAccountId_key" ON "ConnectedAccount"("operatorAccountId", "ownerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverGroup_accountId_name_key" ON "DriverGroup"("accountId", "name");

-- CreateIndex
CREATE INDEX "DriverGroupMember_driverGroupId_idx" ON "DriverGroupMember"("driverGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverGroupMember_driverId_driverGroupId_key" ON "DriverGroupMember"("driverId", "driverGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverGroupTariff_driverGroupId_tariffId_key" ON "DriverGroupTariff"("driverGroupId", "tariffId");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_code_key" ON "QrCode"("code");

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_operatorAccountId_fkey" FOREIGN KEY ("operatorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_operatorAccountId_fkey" FOREIGN KEY ("operatorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charger" ADD CONSTRAINT "Charger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_driverGroupId_fkey" FOREIGN KEY ("driverGroupId") REFERENCES "DriverGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverGroup" ADD CONSTRAINT "DriverGroup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverGroupMember" ADD CONSTRAINT "DriverGroupMember_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverGroupMember" ADD CONSTRAINT "DriverGroupMember_driverGroupId_fkey" FOREIGN KEY ("driverGroupId") REFERENCES "DriverGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverGroupTariff" ADD CONSTRAINT "DriverGroupTariff_driverGroupId_fkey" FOREIGN KEY ("driverGroupId") REFERENCES "DriverGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverGroupTariff" ADD CONSTRAINT "DriverGroupTariff_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
