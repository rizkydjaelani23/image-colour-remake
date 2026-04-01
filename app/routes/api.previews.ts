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

    const shop = await getOrCreateShop(shopDomain);

    let product = null;

    if (productId) {
      product = await prisma.product.findFirst({
        where: {
          shopId: shop.id,
          shopifyProductId: productId,
        },
      });
    } else {
      const latestPreview = await prisma.preview.findFirst({
        where: {
          shopId: shop.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          product: true,
        },
      });

      product = latestPreview?.product ?? null;
    }

    if (!product) {
      return Response.json({
        success: true,
        product: null,
        previews: [],
      });
    }

    const previews = await prisma.preview.findMany({
      where: {
        shopId: shop.id,
        productId: product.id,
      },
      orderBy: [
        { fabricFamily: "asc" },
        { colourName: "asc" },
        { createdAt: "desc" },
      ],
    });

    return Response.json({
      success: true,
      product: {
        id: product.id,
        showOnStorefront: product.showOnStorefront,
        shopifyProductId: product.shopifyProductId,
        title: product.title,
        handle: product.handle,
        imageUrl: product.imageUrl,
      },
      previews,
    });
    
  } catch (error) {
    console.error("api.previews loader error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error loading previews",
      },
      { status: 500 },
    );
  }
}