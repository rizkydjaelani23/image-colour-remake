import { prisma } from "./db.server";

export async function createPreviewRecord(params: {
  shopId: string;
  productId: string;
  zoneId: string;
  colourName: string;
  swatchUrl: string;
  previewUrl: string;
  fabricFamilyName?: string | null;
  fabricFamilyId?: string | null;
}) {
  return prisma.preview.create({
    data: {
      shopId: params.shopId,
      productId: params.productId,
      zoneId: params.zoneId,
      colourName: params.colourName,
      swatchUrl: params.swatchUrl,
      previewUrl: params.previewUrl,
      fabricFamilyName: params.fabricFamilyName ?? null,
      fabricFamilyId: params.fabricFamilyId ?? null,
    },
  });
}

export async function listProductPreviews(productId: string) {
  return prisma.preview.findMany({
    where: { productId },
    orderBy: [{ fabricFamilyName: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });
}

export async function updatePreviewApproval(previewId: string, approvedForStorefront: boolean) {
  return prisma.preview.update({
    where: { id: previewId },
    data: { approvedForStorefront },
  });
}

export async function updatePreviewFeatured(previewId: string, featuredForFamily: boolean) {
  return prisma.preview.update({
    where: { id: previewId },
    data: { featuredForFamily },
  });
}