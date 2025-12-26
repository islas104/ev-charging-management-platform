-- CreateTable
CREATE TABLE "MeterValue" (
    "id" SERIAL NOT NULL,
    "chargerId" INTEGER NOT NULL,
    "transactionId" INTEGER,
    "ocppTransactionId" INTEGER,
    "connectorId" INTEGER,
    "timestamp" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeterValue_chargerId_createdAt_idx" ON "MeterValue"("chargerId", "createdAt");

-- CreateIndex
CREATE INDEX "MeterValue_ocppTransactionId_idx" ON "MeterValue"("ocppTransactionId");

-- AddForeignKey
ALTER TABLE "MeterValue" ADD CONSTRAINT "MeterValue_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterValue" ADD CONSTRAINT "MeterValue_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
