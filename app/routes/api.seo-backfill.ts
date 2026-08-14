/**
 * POST /api/seo-backfill
 *
 * The explicit, merchant-triggered "catch-up" action for the Fabric SEO
 * Engine. Runs the SAME sync (metafield + fabric-* tags + collection page,
 * created if missing) as the automatic per-approval sync — but across EVERY
 * product in the shop that has at least one approved, visible colour.
 *
 * Why this exists as a separate manual action rather than firing automatically:
 *   - Activating the SEO add-on (api.seo-billing-return.tsx) only flips a flag
 *     — it never touches Shopify. Nothing runs on purchase.
 *   - Any colours approved BEFORE this add-on existed (or before a merchant's
 *     specific approval action triggered a sync) won't have live collection
 *     pages yet. This route catches those up — on demand, with the merchant's
 *     explicit click, since it can create many new live storefront pages at
 *     once and that shouldn't happen silently or automatically.
 *
 * Gated behind the SEO add-on, same as every other SEO route.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { syncProductsSeo } from "../utils/seo-autosync.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    if (!isSeoAddonActive(shop)) {
      return Response.json(
        { error: "Fabric SEO Engine add-on is not active for this shop." },
        { status: 403 },
      );
    }

    // Every product with at least one approved, visible colour.
    const products = await prisma.product.findMany({
      where: {
        shopId: shop.id,
        previews: { some: { approvedForStorefront: true, NOT: { status: "HIDDEN" } } },
      },
      select: { id: true, shopifyProductId: true },
    });

    if (products.length === 0) {
      return Response.json({ ok: true, products: 0, message: "No approved colours to sync yet." });
    }

    // Fire-and-forget: a full-catalogue sync can be hundreds of sequential
    // Shopify API calls (rate-limit-safe, one product at a time inside
    // syncProductsSeo) — long enough to risk an HTTP timeout if awaited here.
    // Idempotent, so safe to re-click "Execute" again if the process restarts
    // mid-run; nothing is lost, it just re-syncs the same correct state.
    const productList = products.map((p) => ({ shopifyProductId: p.shopifyProductId, productId: p.id }));
    console.log(`[seo-backfill] shop=${shop.shopDomain} starting — ${productList.length} products`);
    void syncProductsSeo(admin, shop, productList).then(() => {
      console.log(`[seo-backfill] shop=${shop.shopDomain} finished — ${productList.length} products`);
    });

    return Response.json({ ok: true, started: true, products: products.length });
  } catch (error) {
    console.error("api.seo-backfill error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error during SEO backfill" },
      { status: 500 },
    );
  }
}
