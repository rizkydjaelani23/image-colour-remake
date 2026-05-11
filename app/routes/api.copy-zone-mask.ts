import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { upsertProduct } from "../utils/products.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();
    const sourceZoneId      = formData.get("sourceZoneId") as string;
    const targetProductId   = formData.get("targetProductId") as string;   // Shopify GID
    const targetProductTitle = formData.get("targetProductTitle") as string | null;
    const targetImageUrl    = formData.get("targetImageUrl") as string | null;
    const zoneName          = (formData.get("zoneName") as string | null)?.trim() || "Main Area";

    if (!sourceZoneId || !targetProductId) {
      return Response.json({ error: "Missing sourceZoneId or targetProductId" }, { status: 400 });
    }

    const shop = await getOrCreateShop(shopDomain);

    // Load source zone — must belong to the same shop
    const sourceZone = await prisma.zone.findFirst({
      where: { id: sourceZoneId, shopId: shop.id },
    });

    if (!sourceZone) {
      return Response.json({ error: "Source zone not found" }, { status: 404 });
    }

    if (!sourceZone.maskPath) {
      return Response.json({ error: "Source zone has no mask" }, { status: 400 });
    }

    // Ensure target product exists in DB
    const targetProduct = await upsertProduct({
      shopId: shop.id,
      shopifyProductId: targetProductId,
      title: targetProductTitle ?? null,
      imageUrl: targetImageUrl ?? null,
    });

    // Create a new zone for the target product, reusing the source maskPath
    const newKey = `zone-${Date.now()}`;

    const newZone = await prisma.zone.upsert({
      where: {
        productId_key: {
          productId: targetProduct.id,
          key: newKey,
        },
      },
      update: {
        name: zoneName,
        maskPath: sourceZone.maskPath,
      },
      create: {
        shopId: shop.id,
        productId: targetProduct.id,
        key: newKey,
        name: zoneName,
        maskPath: sourceZone.maskPath,
      },
    });

    return Response.json({ success: true, zone: newZone });
  } catch (err) {
    console.error("copy-zone-mask error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
