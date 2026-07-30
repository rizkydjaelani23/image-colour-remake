/**
 * POST /api/bulk-approve-products
 * Approves or unapproves ALL previews for a set of products in one DB call.
 * Body: { shopifyProductIds: string[], approve: boolean }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { syncProductsSeo } from "../utils/seo-autosync.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { shopifyProductIds, approve } = (await request.json()) as {
    shopifyProductIds?: string[];
    approve?: boolean;
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

  // Approve / unapprove every preview for the selected products in one DB call
  const result = await prisma.preview.updateMany({
    where: { productId: { in: productIds } },
    data: { approvedForStorefront: approve ?? true },
  });

  // When approving, also ensure the product-level "Show on storefront" switch is ON
  // so the gallery actually becomes visible (matches what the per-product toggle does).
  if (approve ?? true) {
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { showOnStorefront: true },
    });
  }

  // Return fresh per-product counts so the client can update badges without a full reload
  // Also pull colour names so we can fire the SEO metafield update
  const updatedProducts = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id:               true,
      shopifyProductId: true,
      showOnStorefront:  true,
      previews: {
        where: { approvedForStorefront: true, NOT: { status: "HIDDEN" } },
        select: {
          id:                  true,
          colourName:          true,
          customerDisplayName: true,
          fabricFamily:        true,
        },
        orderBy: [{ fabricFamily: "asc" }, { colourName: "asc" }],
      },
    },
  });

  // ── Fabric SEO Engine: silent backend auto-sync ──────────────────────────
  // Metafield + fabric-* tags + collection pages, all kept in sync for every
  // affected product. Fire-and-forget: never blocks this response, never
  // surfaces to the merchant or customer. No-op instantly if the shop isn't
  // on the SEO add-on (checked once inside syncProductsSeo).
  void syncProductsSeo(
    admin,
    shop,
    updatedProducts.map((p) => ({ shopifyProductId: p.shopifyProductId, productId: p.id })),
  );

  return Response.json({
    ok: true,
    count: result.count,
    productCount: products.length,
    products: updatedProducts.map((p) => ({
      shopifyProductId: p.shopifyProductId,
      approvedCount: p.previews.length,
      showOnStorefront: p.showOnStorefront,
    })),
  });
}
