-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "totalCost" DECIMAL(12,4),
ADD COLUMN     "totalEnergyKwh" DECIMAL(12,4),
ADD COLUMN     "totalIdleMinutes" INTEGER;

-- CreateTable
CREATE TABLE "RemoteCommand" (
    "id" SERIAL NOT NULL,
    "chargerId" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemoteCommand_chargerId_createdAt_idx" ON "RemoteCommand"("chargerId", "createdAt");

-- CreateIndex
CREATE INDEX "RemoteCommand_messageId_idx" ON "RemoteCommand"("messageId");

-- AddForeignKey
ALTER TABLE "RemoteCommand" ADD CONSTRAINT "RemoteCommand_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
