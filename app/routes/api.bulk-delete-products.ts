/**
 * POST /api/bulk-delete-products
 * Deletes ALL previews for a set of products in one DB call, then hides those
 * products on the storefront (nothing to show any more).
 * Body: { shopifyProductIds: string[] }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { shopifyProductIds } = (await request.json()) as {
    shopifyProductIds?: string[];
  };

  if (!Array.isArray(shopifyProductIds) || shopifyProductIds.length === 0) {
    return Response.json({ error: "No products selected." }, { status: 400 });
  }

  // Resolve to internal product IDs, scoped to this shop for safety
  const products = await prisma.product.findMany({
    where: {
      shopId: shop.id,
      shopifyProductId: { in: shopifyProductIds },
    },
    select: { id: true },
  });

  if (products.length === 0) {
    return Response.json({ error: "No matching products found." }, { status: 404 });
  }

  const productIds = products.map((p) => p.id);

  // Delete every preview for the selected products in one call
  const result = await prisma.preview.deleteMany({
    where: { productId: { in: productIds } },
  });

  // Hide the products on the storefront — no previews left to display
  await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: { showOnStorefront: false },
  });

  return Response.json({
    ok: true,
    count: result.count,
    productCount: products.length,
    deletedProductIds: shopifyProductIds,
  });
}
