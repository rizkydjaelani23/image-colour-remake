import prisma from "./db.server";
import { PRO_PREVIEW_LIMIT, FREE_HD_TOKENS } from "./billing.server";

export async function syncShopUsage(params: {
  shopId: string;
  previewLimit: number;
  /** Monthly included HD render tokens for the shop's current plan. */
  hdTokenLimit?: number;
  resetExpiredCycle?: boolean;
  /**
   * Set to false when the billing API call failed and returned a fallback value.
   * When false, the stored previewLimit/hdTokenLimit are preserved so a transient
   * Shopify API failure doesn't accidentally downgrade a Pro store. The create
   * path always uses PRO_PREVIEW_LIMIT as a safe default for new shops when the
   * API is unavailable.
   */
  updateLimit?: boolean;
}) {
  const now = new Date();
  const nextPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const shouldUpdateLimit = params.updateLimit !== false; // default true
  const hdLimit = params.hdTokenLimit;

  let usage = await prisma.shopUsage.upsert({
    where: { shopId: params.shopId },
    create: {
      shopId: params.shopId,
      previewCount: 0,
      // If API is down and we're creating a new record, be generous on previews
      // (Pro limit) but conservative on HD (free taster) — HD costs real money.
      previewLimit: shouldUpdateLimit ? params.previewLimit : PRO_PREVIEW_LIMIT,
      hdTokensUsed: 0,
      hdTokenLimit: shouldUpdateLimit ? (hdLimit ?? FREE_HD_TOKENS) : FREE_HD_TOKENS,
      periodStart: now,
      periodEnd: nextPeriodEnd,
    },
    update: shouldUpdateLimit
      ? {
          previewLimit: params.previewLimit,
          // Only overwrite the HD limit when we actually know it (param supplied)
          ...(hdLimit !== undefined ? { hdTokenLimit: hdLimit } : {}),
        }
      : {}, // preserve whatever is in the DB when API is unreliable
  });

  if (params.resetExpiredCycle && now > usage.periodEnd) {
    usage = await prisma.shopUsage.update({
      where: { shopId: params.shopId },
      data: {
        previewCount: 0,
        // Reset the monthly HD grant — but NEVER touch hdTokensExtra (paid top-ups)
        hdTokensUsed: 0,
        ...(shouldUpdateLimit ? { previewLimit: params.previewLimit } : {}),
        ...(shouldUpdateLimit && hdLimit !== undefined ? { hdTokenLimit: hdLimit } : {}),
        periodStart: now,
        periodEnd: nextPeriodEnd,
      },
    });
  }

  return usage;
}
