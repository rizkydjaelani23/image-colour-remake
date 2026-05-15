-- CreateTable
CREATE TABLE "GscConnection" (
    "id"             TEXT NOT NULL,
    "shopId"         TEXT NOT NULL,
    "siteUrl"        TEXT NOT NULL,
    "accessToken"    TEXT NOT NULL,
    "refreshToken"   TEXT NOT NULL,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "cachedData"     TEXT,
    "cacheUpdatedAt" TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GscConnection_shopId_key" ON "GscConnection"("shopId");

-- AddForeignKey
ALTER TABLE "GscConnection" ADD CONSTRAINT "GscConnection_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
