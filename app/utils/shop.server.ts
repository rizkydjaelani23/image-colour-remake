import prisma from "./db.server";

export async function getOrCreateShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    update: {},
    create: {
      shopDomain,
    },
  });
}