/**
 * Fabric SEO Engine — colour rename utility
 *
 * Lets a merchant fix a bad/generic colour name (e.g. one inherited from an
 * uploaded file name like "Naples_Colours_03") without leaving stale tags or
 * dead collection pages behind.
 *
 * A colour's Shopify tag and collection handle are always computed fresh
 * from its display name (see utils/colour.ts) — nothing is stored under the
 * old name once this runs. Renaming therefore means:
 *   1. Update every Preview row (across every product) that currently shows
 *      this name, to the new name.
 *   2. Re-sync every affected product — this adds the new fabric-* tag,
 *      removes the old one, and creates+publishes the new collection.
 *   3. Delete the old collection page, since after step 2 nothing feeds it
 *      any more and a leftover empty automated collection is dead weight.
 */

import prisma from "./db.server";
import { syncProductSeo } from "./seo-autosync.server";
import { deleteFabricCollections } from "./seo-cleanup.server";

// ── Types ────────────────────────────────────────────────────────────────────

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ShopForRename = { id: string; shopDomain: string; seoAddonActive: boolean };

export type RenameResult = {
  renamedPreviews:      number;
  productsResynced:     number;
  oldCollectionDeleted: boolean;
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renames a fabric colour shop-wide and brings Shopify back in sync.
 * Safe to call even if the SEO add-on isn't active — the DB rename still
 * happens (so the Fabric Index table is correct either way), Shopify sync
 * is just skipped.
 */
export async function renameFabricColour(
  admin:   AdminGraphql,
  shop:    ShopForRename,
  oldName: string,
  newName: string,
): Promise<RenameResult> {
  const trimmedNew = newName.trim();
  if (!trimmedNew || trimmedNew === oldName) {
    return { renamedPreviews: 0, productsResynced: 0, oldCollectionDeleted: false };
  }

  // Every preview whose EFFECTIVE name (customerDisplayName || colourName)
  // currently equals oldName. Fetched in JS since Prisma can't COALESCE-filter
  // (same approach the SEO dashboard loader uses to build the Fabric Index).
  const candidates = await prisma.preview.findMany({
    where:  { shopId: shop.id },
    select: {
      id:                  true,
      colourName:          true,
      customerDisplayName: true,
      productId:           true,
      shopifyProductId:    true,
    },
  });
  const matches = candidates.filter((p) => (p.customerDisplayName || p.colourName) === oldName);
  if (matches.length === 0) {
    return { renamedPreviews: 0, productsResynced: 0, oldCollectionDeleted: false };
  }

  // Always write to customerDisplayName — it's the designated override field,
  // so the original colourName (used for swatch/import matching elsewhere)
  // is never touched.
  await prisma.preview.updateMany({
    where: { id: { in: matches.map((m) => m.id) } },
    data:  { customerDisplayName: trimmedNew },
  });

  // Re-sync every distinct product this colour appears on — this adds the new
  // fabric-* tag, drops the old one, and creates+publishes the new collection.
  const distinctProducts = [...new Map(
    matches.map((m) => [m.productId, { productId: m.productId, shopifyProductId: m.shopifyProductId }]),
  ).values()];

  if (shop.seoAddonActive) {
    for (const p of distinctProducts) {
      await syncProductSeo(admin, shop, p.shopifyProductId, p.productId);
    }
  }

  // The old collection is now empty — every product that fed it just moved
  // to the new tag — so delete it rather than leave a dead automated page.
  let oldCollectionDeleted = false;
  if (shop.seoAddonActive) {
    try {
      oldCollectionDeleted = (await deleteFabricCollections(admin, [oldName])) > 0;
    } catch (error) {
      console.error("renameFabricColour: old collection cleanup failed:", error);
    }
  }

  return {
    renamedPreviews:  matches.length,
    productsResynced: distinctProducts.length,
    oldCollectionDeleted,
  };
}
