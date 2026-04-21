import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const shop = await getOrCreateShop(shopDomain);

    // Return all swatches the shop has used, most recently updated first.
    // "updatedAt" is set whenever we generate a preview with this swatch,
    // so the most recently used naturally rise to the top.
    const swatches = await prisma.swatch.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return Response.json({
      success: true,
      swatches: swatches.map((swatch) => ({
        id: swatch.id,
        fabricFamily: swatch.fabricFamily,
        colourName: swatch.colourName,
        imageUrl: swatch.imageUrl,
        hex: swatch.hex,
        updatedAt: swatch.updatedAt,
      })),
    });
  } catch (error) {
    console.error("api.recent-swatches loader error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error loading recent swatches",
      },
      { status: 500 },
    );
  }
}