/**
 * POST /api/seo-disable
 *
 * Removes all Fabric SEO Engine data from the merchant's Shopify store:
 *   • Deletes power_your_house.fabric_colours metafield from all products
 *   • Removes all fabric-* tags from all products
 *   • Deletes all fabric-* automated collection pages
 *
 * Does NOT delete any data from our own DB — that stays intact so the
 * merchant can re-enable the SEO Engine and run sync again without losing
 * anything. Our records are only purged by the app/uninstalled webhook.
 *
 * Alt text (rendered by gallery.js) does not need explicit cleanup — it
 * ceases to render when the theme extension block is removed.
 *
 * Response:
 *   {
 *     ok: true,
 *     clearedMetafields: number,   // products whose metafield was removed
 *     clearedTags:       number,   // products whose fabric tags were removed
 *     deletedCollections: number,  // collection pages deleted
 *   }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import {
  clearFabricMetafields,
  clearFabricTags,
  deleteFabricCollections,
} from "../utils/seo-cleanup.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    // Gate — must have SEO add-on (so they can clean up what they've built)
    if (!isSeoAddonActive(shop)) {
      return Response.json(
        { error: "Fabric SEO Engine add-on is not active for this shop." },
        { status: 403 },
      );
    }

    // ── 1. Gather data from DB ────────────────────────────────────────────────
    // All products (for metafield + tag cleanup)
    const products = await prisma.product.findMany({
      where: { shopId: shop.id },
      select: { shopifyProductId: true },
    });
    const shopifyProductIds = products.map((p) => p.shopifyProductId);

    // All unique colour names (to compute which collection handles to delete
    // and which fabric tags to remove)
    const previews = await prisma.preview.findMany({
      where: { shopId: shop.id },
      select: { colourName: true, customerDisplayName: true },
    });

    const seen = new Set<string>();
    const allColourNames: string[] = [];
    for (const p of previews) {
      const name = p.customerDisplayName || p.colourName;
      if (!seen.has(name)) { seen.add(name); allColourNames.push(name); }
    }

    // ── 2. Run cleanup in sequence ────────────────────────────────────────────
    // Metafields first (fastest — batch of 25)
    const clearedMetafields = await clearFabricMetafields(admin, shopifyProductIds);

    // Tags next (1 API call per product — may be slow for large catalogs)
    const clearedTags = await clearFabricTags(admin, shopifyProductIds, allColourNames);

    // Collections last (1 batch check + 1 delete per existing collection)
    const deletedCollections = await deleteFabricCollections(admin, allColourNames);

    return Response.json({
      ok: true,
      clearedMetafields,
      clearedTags,
      deletedCollections,
    });

  } catch (error) {
    console.error("api.seo-disable error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error during SEO cleanup" },
      { status: 500 },
    );
  }
}
