/**
 * POST /api/seo-sync
 *
 * Bulk-syncs the full SEO package for every product in the shop:
 *   1. Writes `power_your_house.fabric_colours` metafield (colour list as text)
 *   2. Syncs `fabric-{colour}` tags on each product (drives collection pages)
 *
 * This is the "catch-up" route for merchants who generated images before
 * the Fabric SEO Engine add-on was activated on their account.
 *
 * Response shape:
 *   { ok: true, synced: number, skipped: number, total: number, tagsSynced: number }
 *
 * `synced`     – products that had ≥1 approved colour and got a metafield written
 * `skipped`    – products with no approved colours (nothing to write)
 * `total`      – all products queried for this shop
 * `tagsSynced` – products whose Shopify tags were updated
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { batchUpdateFabricColoursMetafields } from "../utils/seo-metafield.server";
import { batchUpdateFabricTags } from "../utils/seo-tags.server";

const METAFIELD_BATCH = 25; // Shopify metafieldsSet limit per call

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    // Gate: only shops with the SEO add-on may use this
    if (!isSeoAddonActive(shop)) {
      return Response.json(
        { error: "Fabric SEO Engine add-on is not active for this shop." },
        { status: 403 },
      );
    }

    // ── 1. Fetch all products with their approved previews ───────────────────
    const products = await prisma.product.findMany({
      where: { shopId: shop.id },
      select: {
        id:               true,
        shopifyProductId: true,
        previews: {
          where: {
            approvedForStorefront: true,
            NOT: { status: "HIDDEN" },
          },
          select: {
            colourName:          true,
            customerDisplayName: true,
            fabricFamily:        true,
          },
          orderBy: [{ fabricFamily: "asc" }, { colourName: "asc" }],
        },
      },
    });

    const total = products.length;

    // ── 2. Build per-product colour lists ────────────────────────────────────
    type ProductRow = {
      id:               string;
      shopifyProductId: string;
      colourNames:      string[];
    };

    const rows: ProductRow[] = products.map((p) => {
      const seen = new Set<string>();
      const colourNames: string[] = [];
      for (const pv of p.previews) {
        const name = pv.customerDisplayName || pv.colourName;
        if (!seen.has(name)) { seen.add(name); colourNames.push(name); }
      }
      return { id: p.id, shopifyProductId: p.shopifyProductId, colourNames };
    });

    const toSync  = rows.filter((r) => r.colourNames.length > 0);
    const skipped = total - toSync.length;

    if (toSync.length === 0) {
      return Response.json({ ok: true, synced: 0, tagsSynced: 0, skipped, total });
    }

    // ── 3a. Metafields — batch 25 per GraphQL call ────────────────────────────
    let synced = 0;
    for (let i = 0; i < toSync.length; i += METAFIELD_BATCH) {
      const batch   = toSync.slice(i, i + METAFIELD_BATCH);
      const written = await batchUpdateFabricColoursMetafields(admin, batch);
      synced += written;
    }

    // ── 3b. Tags — sequential per-product (reads + writes to Shopify) ─────────
    // We sync ALL products (including those with 0 colours) so that
    // unapproved-and-emptied products have their fabric tags cleaned up too.
    const tagsSynced = await batchUpdateFabricTags(
      admin,
      products.map((p) => ({ shopifyProductId: p.shopifyProductId, productId: p.id })),
    );

    return Response.json({ ok: true, synced, tagsSynced, skipped, total });

  } catch (error) {
    console.error("api.seo-sync error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error during SEO sync" },
      { status: 500 },
    );
  }
}
