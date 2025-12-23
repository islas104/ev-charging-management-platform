-- CreateTable
CREATE TABLE "ConnectorStatus" (
    "id" SERIAL NOT NULL,
    "chargerId" INTEGER NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "vendorError" TEXT,
    "info" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcppMessageLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chargerId" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "messageId" TEXT,
    "raw" JSONB NOT NULL,
    "status" TEXT,

    CONSTRAINT "OcppMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorStatus_chargerId_idx" ON "ConnectorStatus"("chargerId");

-- CreateIndex
CREATE INDEX "ConnectorStatus_status_idx" ON "ConnectorStatus"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorStatus_chargerId_connectorId_key" ON "ConnectorStatus"("chargerId", "connectorId");

-- CreateIndex
CREATE INDEX "OcppMessageLog_chargerId_createdAt_idx" ON "OcppMessageLog"("chargerId", "createdAt");

-- CreateIndex
CREATE INDEX "OcppMessageLog_operation_idx" ON "OcppMessageLog"("operation");

-- CreateIndex
CREATE INDEX "OcppMessageLog_messageId_idx" ON "OcppMessageLog"("messageId");

-- AddForeignKey
ALTER TABLE "ConnectorStatus" ADD CONSTRAINT "ConnectorStatus_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcppMessageLog" ADD CONSTRAINT "OcppMessageLog_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
