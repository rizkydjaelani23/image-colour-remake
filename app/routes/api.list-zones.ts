import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    if (!productId) {
      return Response.json({ error: "Missing productId" }, { status: 400 });
    }

    const shop = await getOrCreateShop(shopDomain);

    const product = await prisma.product.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId: productId,
      },
    });

    if (!product) {
      return Response.json({
        success: true,
        zones: [],
        baseImageUrl: null,
      });
    }

    const zones = await prisma.zone.findMany({
      where: {
        shopId: shop.id,
        productId: product.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return Response.json({
      success: true,
      zones: zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        maskPath: zone.maskPath,
        createdAt: zone.createdAt,
        updatedAt: zone.updatedAt,
      })),
      baseImageUrl: product.imageUrl ?? null,
    });
  } catch (error) {
    console.error("list-zones error:", error);

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error loading zones",
      },
      { status: 500 },
    );
  }
}