import type { LoaderFunctionArgs } from "react-router";
import prisma from "../utils/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");
    const productId = url.searchParams.get("productId");

    if (!shopDomain) {
      return Response.json({ error: "Missing shop" }, { status: 400 });
    }

    if (!productId) {
      return Response.json({ error: "Missing productId" }, { status: 400 });
    }

    const shop = await prisma.shop.findFirst({
      where: {
        shopDomain,
      },
    });

    if (!shop) {
      return Response.json({
        success: true,
        product: null,
        previews: [],
      });
    }

    const product = await prisma.product.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId: productId,
      },
    });

    if (!product) {
      return Response.json({
        success: true,
        product: null,
        previews: [],
      });
    }

    if (!product.showOnStorefront) {
      return Response.json({
        success: true,
        product: {
          id: product.id,
          shopifyProductId: product.shopifyProductId,
          title: product.title,
          handle: product.handle,
          imageUrl: product.imageUrl,
        },
        previews: [],
      });
    }

    const previews = await prisma.preview.findMany({
      where: {
        shopId: shop.id,
        productId: product.id,
        approvedForStorefront: true,
        NOT: {
          status: "HIDDEN",
        },
      },
      orderBy: [
        { featured: "desc" },
        { fabricFamily: "asc" },
        { colourName: "asc" },
      ],
    });

    return Response.json({
      success: true,
      product: {
        id: product.id,
        shopifyProductId: product.shopifyProductId,
        title: product.title,
        handle: product.handle,
        imageUrl: product.imageUrl,
      },
      // Use customerDisplayName as the colourName if set — gallery.js reads colourName
      previews: previews.map((p) => ({
        ...p,
        colourName: p.customerDisplayName || p.colourName,
      })),
    });
  } catch (error) {
    console.error("api.storefront-previews loader error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error loading storefront previews",
      },
      { status: 500 },
    );
  }
}