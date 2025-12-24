-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" SERIAL NOT NULL,
    "baseEnergyGbpKwh" DECIMAL(10,4) NOT NULL,
    "platformMarkup" DECIMAL(5,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);
