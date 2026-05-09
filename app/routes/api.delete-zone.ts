import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { deleteFileFromStorage } from "../utils/storage.server";
import { safeFolderName } from "../utils/visualiser.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();

    const productId = formData.get("productId");
    const zoneId = formData.get("zoneId");

    if (!productId || typeof productId !== "string") {
      return Response.json({ error: "Missing productId" }, { status: 400 });
    }

    if (!zoneId || typeof zoneId !== "string") {
      return Response.json({ error: "Missing zoneId" }, { status: 400 });
    }

    const shop = await getOrCreateShop(shopDomain);

    const product = await prisma.product.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId: productId,
      },
    });

    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }

    const zone = await prisma.zone.findFirst({
      where: {
        id: zoneId,
        shopId: shop.id,
        productId: product.id,
      },
    });

    if (!zone) {
      return Response.json({ error: "Zone not found" }, { status: 404 });
    }

    // Delete related previews first
    await prisma.preview.deleteMany({
      where: {
        zoneId: zone.id,
      },
    });

    // Delete mask from Supabase (new) or ignore legacy local paths
    if (zone.maskPath && zone.maskPath.startsWith("http")) {
      try {
        const safeProductId = safeFolderName(productId);
        const maskStoragePath = `${shopDomain}/masks/${safeProductId}/${zone.key}.png`;
        await deleteFileFromStorage(maskStoragePath);
      } catch {
        // ignore cleanup errors — zone DB record still gets deleted
      }
    }

    await prisma.zone.delete({
      where: {
        id: zone.id,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("delete-zone error:", error);

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error deleting zone",
      },
      { status: 500 },
    );
  }
}