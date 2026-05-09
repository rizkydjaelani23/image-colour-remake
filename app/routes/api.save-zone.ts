import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { upsertProduct } from "../utils/products.server";
import { safeFolderName } from "../utils/visualiser.server";
import { uploadBufferToStorage } from "../utils/storage.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();

    const productId = formData.get("productId") as string;
    const zoneId = formData.get("zoneId") as string;
    const zoneName = formData.get("zoneName") as string;
    const baseImageUrl = formData.get("baseImageUrl") as string;
    const maskFile = formData.get("mask") as File | null;

    if (!productId || !zoneId || !zoneName || !maskFile) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // 1. Ensure shop
    const shop = await getOrCreateShop(shopDomain);

    // 2. Ensure product
    const product = await upsertProduct({
      shopId: shop.id,
      shopifyProductId: productId,
      title: null,
      handle: null,
      imageUrl: baseImageUrl ?? null,
    });

    // 3. Save mask to Supabase storage
    const buffer = Buffer.from(await maskFile.arrayBuffer());

    const safeProductId = safeFolderName(productId);
    const maskStoragePath = `${shopDomain}/masks/${safeProductId}/${zoneId}.png`;

    const uploaded = await uploadBufferToStorage({
      path: maskStoragePath,
      buffer,
      contentType: "image/png",
      upsert: true,
    });

    const publicMaskPath = uploaded.publicUrl;

    // 4. Save zone in Prisma
    const zone = await prisma.zone.upsert({
      where: {
        productId_key: {
          productId: product.id,
          key: zoneId,
        },
      },
      update: {
        name: zoneName,
        maskPath: publicMaskPath,
      },
      create: {
        shopId: shop.id,
        productId: product.id,
        key: zoneId,
        name: zoneName,
        maskPath: publicMaskPath,
      },
    });

    return Response.json({
      success: true,
      zone,
    });
  } catch (error) {
    console.error("save-zone error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error saving zone",
      },
      { status: 500 },
    );
  }
}