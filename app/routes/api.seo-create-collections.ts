/**
 * POST /api/seo-create-collections
 *
 * Creates one automated Shopify collection page per unique approved colour
 * across all products in the shop.
 *
 * Collections are idempotent — already-existing ones are left untouched.
 * Only missing ones are created.
 *
 * Each collection:
 *   - Handle: `fabric-{colour-slug}`
 *   - URL:    /collections/fabric-{colour-slug}
 *   - Rule:   TAG equals "fabric-{colour-slug}"
 *   - Published: true (live, indexed by Google)
 *   - NOT added to store navigation (merchant controls that separately)
 *
 * Response:
 *   {
 *     ok: true,
 *     created: number,     // newly created collections
 *     existing: number,    // collections that already existed (skipped)
 *     failed: number,      // collections that failed to create
 *     collections: CollectionResult[]
 *   }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { ensureFabricCollections } from "../utils/seo-collections.server";

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

    // ── 1. Gather all unique approved colour names across this shop ───────────
    const previews = await prisma.preview.findMany({
      where: {
        shopId: shop.id,
        approvedForStorefront: true,
        NOT: { status: "HIDDEN" },
      },
      select: {
        colourName:          true,
        customerDisplayName: true,
      },
    });

    // Deduplicate colour names
    const seen = new Set<string>();
    const colourNames: string[] = [];
    for (const p of previews) {
      const name = p.customerDisplayName || p.colourName;
      if (!seen.has(name)) { seen.add(name); colourNames.push(name); }
    }

    if (colourNames.length === 0) {
      return Response.json({
        ok:          true,
        created:     0,
        existing:    0,
        failed:      0,
        collections: [],
      });
    }

    // ── 2. Create missing collections ─────────────────────────────────────────
    const results = await ensureFabricCollections(admin, colourNames, shop.shopDomain);

    const created  = results.filter((r) => r.created && !r.error).length;
    const existing = results.filter((r) => !r.created && !r.error).length;
    const failed   = results.filter((r) => !!r.error).length;

    return Response.json({ ok: true, created, existing, failed, collections: results });

  } catch (error) {
    console.error("api.seo-create-collections error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error creating collections" },
      { status: 500 },
    );
  }
}
