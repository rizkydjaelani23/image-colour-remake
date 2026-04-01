-- CreateTable
CREATE TABLE "ShopUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "previewCount" INTEGER NOT NULL DEFAULT 0,
    "previewLimit" INTEGER NOT NULL DEFAULT 50,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopUsage_shopId_key" ON "ShopUsage"("shopId");

-- AddForeignKey
ALTER TABLE "ShopUsage" ADD CONSTRAINT "ShopUsage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
