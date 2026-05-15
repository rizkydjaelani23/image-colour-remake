-- AlterTable: add Fabric SEO Engine add-on fields to Shop
-- seoAddonActive is false by default — no existing merchant is affected.
-- Flipped true by the billing webhook when a merchant purchases the add-on.
ALTER TABLE "Shop" ADD COLUMN "seoAddonActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "seoAddonSubscriptionId" TEXT;
ALTER TABLE "Shop" ADD COLUMN "seoAddonActivatedAt" TIMESTAMP(3);
