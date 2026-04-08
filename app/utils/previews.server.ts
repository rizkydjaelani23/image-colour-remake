import prisma from "./db.server";

export async function createPreviewRecord(params: {
  shopId: string;
  productId: string;
  zoneId: string;
  colourName: string;
  swatchId?: string | null;
  shopifyProductId: string;
  fabricFamily: string;
  imagePath: string;
  imageUrl: string;
  thumbUrl?: string | null;
}) {
  return prisma.preview.create({
    data: {
      shopId: params.shopId,
      productId: params.productId,
      zoneId: params.zoneId,
      swatchId: params.swatchId ?? null,
      shopifyProductId: params.shopifyProductId,
      fabricFamily: params.fabricFamily,
      colourName: params.colourName,
      imagePath: params.imagePath,
      imageUrl: params.imageUrl,
      thumbUrl: params.thumbUrl ?? null,
    },
  });
}

export async function listProductPreviews(productId: string) {
  return prisma.preview.findMany({
    where: { productId },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function updatePreviewApproval(previewId: string, approvedForStorefront: boolean) {
  return prisma.preview.update({
    where: { id: previewId },
    data: { approvedForStorefront },
  });
}

export async function updatePreviewFeatured(previewId: string, featured: boolean) {
  return prisma.preview.update({
    where: { id: previewId },
    data: { featured },
  });
}