import prisma from "./db.server";

export async function upsertProduct(params: {
  shopId: string;
  shopifyProductId: string;
  title?: string | null;
  handle?: string | null;
  imageUrl?: string | null;
}) {
  const { shopId, shopifyProductId, title, handle, imageUrl } = params;

  return prisma.product.upsert({
    where: {
      shopId_shopifyProductId: {
        shopId,
        shopifyProductId,
      },
    },
    update: {
      title,
      handle,
      imageUrl,
    },
    create: {
      shopId,
      shopifyProductId,
      title,
      handle,
      imageUrl,
    },
  });
}