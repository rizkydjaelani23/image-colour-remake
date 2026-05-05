import prisma from "./db.server";

export async function syncShopUsage(params: {
  shopId: string;
  previewLimit: number;
  resetExpiredCycle?: boolean;
}) {
  const now = new Date();
  const nextPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  let usage = await prisma.shopUsage.upsert({
    where: { shopId: params.shopId },
    create: {
      shopId: params.shopId,
      previewCount: 0,
      previewLimit: params.previewLimit,
      periodStart: now,
      periodEnd: nextPeriodEnd,
    },
    update: {
      previewLimit: params.previewLimit,
    },
  });

  if (params.resetExpiredCycle && now > usage.periodEnd) {
    usage = await prisma.shopUsage.update({
      where: { shopId: params.shopId },
      data: {
        previewCount: 0,
        previewLimit: params.previewLimit,
        periodStart: now,
        periodEnd: nextPeriodEnd,
      },
    });
  }

  return usage;
}
