/**
 * Fabric SEO Engine — single entry point for "keep everything in sync".
 *
 * Call this (fire-and-forget) any time a preview's approval state, colour
 * name, or fabric family changes for a product. It brings all three SEO
 * surfaces up to date with the product's CURRENT approved-colour set:
 *   1. `power_your_house.fabric_colours` metafield
 *   2. `fabric-*` product tags
 *   3. The collection page for each currently-approved colour (created if
 *      missing — this is what makes a brand-new colour's page appear without
 *      anyone having to click "Create collection pages" by hand)
 *
 * Fully backend and silent:
 *   - No-op (zero API calls) if the shop hasn't activated the SEO add-on.
 *   - Every step catches its own errors and only logs them — this NEVER
 *     throws, never blocks the caller, never surfaces anything to the
 *     merchant UI or the storefront. Approving a preview always feels
 *     instant regardless of what's happening here in the background.
 *   - Idempotent: safe to call as often as you like for the same product.
 */

import prisma from "./db.server";
import { isSeoAddonActive } from "./seo-addon.server";
import { updateFabricColoursMetafield } from "./seo-metafield.server";
import { updateFabricTags } from "./seo-tags.server";
import { ensureFabricCollections } from "./seo-collections.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ShopForSeo = { id: string; seoAddonActive: boolean; shopDomain: string };

/**
 * Sync every SEO surface for ONE product to match its current approved
 * colours. Safe to call after any preview change (approve, unapprove, rename,
 * re-family) — always fire-and-forget: `void syncProductSeo(...)`.
 */
export async function syncProductSeo(
  admin: AdminGraphql,
  shop: ShopForSeo,
  shopifyProductId: string,
  productId: string,
): Promise<void> {
  if (!isSeoAddonActive(shop)) return; // not subscribed — do nothing, no API calls

  try {
    // Metafield + tags are independent per-product operations — run together.
    await Promise.all([
      updateFabricColoursMetafield(admin, shopifyProductId, productId),
      updateFabricTags(admin, shopifyProductId, productId),
    ]);

    // Ensure a collection page exists for every currently-approved colour.
    // ensureFabricCollections checks by handle first and only creates what's
    // missing, so calling it repeatedly for the same colours is a no-op.
    const previews = await prisma.preview.findMany({
      where: { productId, approvedForStorefront: true, NOT: { status: "HIDDEN" } },
      select: { colourName: true, customerDisplayName: true },
    });
    const colourNames = [...new Set(previews.map((p) => p.customerDisplayName || p.colourName))];
    if (colourNames.length > 0) {
      await ensureFabricCollections(admin, colourNames, shop.shopDomain);
    }
  } catch (error) {
    // Swallow everything — SEO sync must never disturb the merchant or customer
    // experience. Log only, for our own visibility.
    console.error(`[seo-autosync] failed for product ${productId}:`, error);
  }
}

/** Same as syncProductSeo but for several products — sequential to stay
 *  within Shopify's API rate limits (matches the existing batch pattern). */
export async function syncProductsSeo(
  admin: AdminGraphql,
  shop: ShopForSeo,
  products: Array<{ shopifyProductId: string; productId: string }>,
): Promise<void> {
  if (!isSeoAddonActive(shop)) return;
  for (const p of products) {
    await syncProductSeo(admin, shop, p.shopifyProductId, p.productId);
  }
}
