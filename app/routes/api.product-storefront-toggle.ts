import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const body = await request.json();
    const { shopifyProductId, showOnStorefront } = body;

    if (!shopifyProductId || typeof shopifyProductId !== "string") {
      return Response.json({ error: "Missing shopifyProductId" }, { status: 400 });
    }

    if (typeof showOnStorefront !== "boolean") {
      return Response.json({ error: "Missing showOnStorefront" }, { status: 400 });
    }

    const shop = await getOrCreateShop(shopDomain);

    const product = await prisma.product.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId,
      },
    });

    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { showOnStorefront },
    });

    return Response.json({
      success: true,
      product: updated,
    });
  } catch (error) {
    console.error("product-storefront-toggle error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error updating storefront product setting",
      },
      { status: 500 },
    );
  }
}