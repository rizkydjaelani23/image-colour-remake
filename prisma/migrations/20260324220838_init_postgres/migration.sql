-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('DRAFT', 'APPROVED', 'HIDDEN', 'FEATURED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT,
    "handle" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "maskPath" TEXT,
    "outlinePath" TEXT,
    "geometryJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Swatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "fabricFamily" TEXT NOT NULL,
    "colourName" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "imageUrl" TEXT,
    "hex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Swatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preview" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "swatchId" TEXT,
    "shopifyProductId" TEXT NOT NULL,
    "fabricFamily" TEXT NOT NULL,
    "colourName" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "status" "PreviewStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedForStorefront" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Product_shopId_idx" ON "Product"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopId_shopifyProductId_key" ON "Product"("shopId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Zone_shopId_productId_idx" ON "Zone"("shopId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_productId_key_key" ON "Zone"("productId", "key");

-- CreateIndex
CREATE INDEX "Swatch_shopId_fabricFamily_idx" ON "Swatch"("shopId", "fabricFamily");

-- CreateIndex
CREATE UNIQUE INDEX "Swatch_shopId_fabricFamily_colourName_key" ON "Swatch"("shopId", "fabricFamily", "colourName");

-- CreateIndex
CREATE INDEX "Preview_shopId_productId_idx" ON "Preview"("shopId", "productId");

-- CreateIndex
CREATE INDEX "Preview_shopId_fabricFamily_idx" ON "Preview"("shopId", "fabricFamily");

-- CreateIndex
CREATE INDEX "Preview_zoneId_idx" ON "Preview"("zoneId");

-- CreateIndex
CREATE INDEX "Preview_approvedForStorefront_featured_idx" ON "Preview"("approvedForStorefront", "featured");

-- CreateIndex
CREATE UNIQUE INDEX "Preview_productId_zoneId_fabricFamily_colourName_key" ON "Preview"("productId", "zoneId", "fabricFamily", "colourName");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swatch" ADD CONSTRAINT "Swatch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preview" ADD CONSTRAINT "Preview_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preview" ADD CONSTRAINT "Preview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preview" ADD CONSTRAINT "Preview_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preview" ADD CONSTRAINT "Preview_swatchId_fkey" FOREIGN KEY ("swatchId") REFERENCES "Swatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
