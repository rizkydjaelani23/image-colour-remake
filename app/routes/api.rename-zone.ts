import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();

    const productId = formData.get("productId");
    const zoneId = formData.get("zoneId");
    const zoneName = formData.get("zoneName");

    if (!productId || typeof productId !== "string") {
      return Response.json({ error: "Missing productId" }, { status: 400 });
    }

    if (!zoneId || typeof zoneId !== "string") {
      return Response.json({ error: "Missing zoneId" }, { status: 400 });
    }

    if (!zoneName || typeof zoneName !== "string" || !zoneName.trim()) {
      return Response.json({ error: "Missing zoneName" }, { status: 400 });
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

    const updatedZone = await prisma.zone.update({
      where: {
        id: zone.id,
      },
      data: {
        name: zoneName.trim(),
      },
    });

    return Response.json({
      success: true,
      zone: {
        id: updatedZone.id,
        name: updatedZone.name,
        maskPath: updatedZone.maskPath,
        createdAt: updatedZone.createdAt,
        updatedAt: updatedZone.updatedAt,
      },
    });
  } catch (error) {
    console.error("rename-zone error:", error);

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error renaming zone",
      },
      { status: 500 },
    );
  }
}