-- Add HD render token accounting to ShopUsage.
-- 1 token = 1 FLUX HD render. hdTokensUsed + hdTokenLimit reset each cycle;
-- hdTokensExtra (paid top-up packs) persists across cycles.
ALTER TABLE "ShopUsage" ADD COLUMN "hdTokensUsed"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopUsage" ADD COLUMN "hdTokenLimit"  INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ShopUsage" ADD COLUMN "hdTokensExtra" INTEGER NOT NULL DEFAULT 0;
