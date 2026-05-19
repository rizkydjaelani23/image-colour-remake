import prisma from "./db.server";
import { PRO_PREVIEW_LIMIT } from "./billing.server";

export async function syncShopUsage(params: {
  shopId: string;
  previewLimit: number;
  resetExpiredCycle?: boolean;
  /**
   * Set to false when the billing API call failed and returned a fallback value.
   * When false, the stored previewLimit is preserved so a transient Shopify API
   * failure doesn't accidentally downgrade a Pro store to the Free limit.
   * The create path always uses PRO_PREVIEW_LIMIT as a safe default for new shops
   * when the API is unavailable.
   */
  updateLimit?: boolean;
}) {
  const now = new Date();
  const nextPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const shouldUpdateLimit = params.updateLimit !== false; // default true

  let usage = await prisma.shopUsage.upsert({
    where: { shopId: params.shopId },
    create: {
      shopId: params.shopId,
      previewCount: 0,
      // If API is down and we're creating a new record, be generous — use Pro limit.
      // The correct limit will be written on the next successful API call.
      previewLimit: shouldUpdateLimit ? params.previewLimit : PRO_PREVIEW_LIMIT,
      periodStart: now,
      periodEnd: nextPeriodEnd,
    },
    update: shouldUpdateLimit
      ? { previewLimit: params.previewLimit }
      : {}, // preserve whatever is in the DB when API is unreliable
  });

  if (params.resetExpiredCycle && now > usage.periodEnd) {
    usage = await prisma.shopUsage.update({
      where: { shopId: params.shopId },
      data: {
        previewCount: 0,
        ...(shouldUpdateLimit ? { previewLimit: params.previewLimit } : {}),
        periodStart: now,
        periodEnd: nextPeriodEnd,
      },
    });
  }

  return usage;
}
