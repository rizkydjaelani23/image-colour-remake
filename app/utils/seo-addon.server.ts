/**
 * Fabric SEO Engine — add-on gate utility
 *
 * During development:
 *   Set SEO_ADDON_DEV=true in .env to bypass the paid flag entirely.
 *   Optionally set SEO_ADDON_TEST_SHOP=your-store.myshopify.com to restrict
 *   the bypass to one specific shop — all other shops stay gated as normal.
 *
 * In production:
 *   SEO_ADDON_DEV must be absent or "false".
 *   isSeoAddonActive() returns shop.seoAddonActive, which is flipped to true
 *   by the Shopify billing webhook when a merchant purchases the add-on and
 *   flipped back to false when they cancel.
 */

type ShopForSeoCheck = {
  seoAddonActive: boolean;
  shopDomain: string;
};

export function isSeoAddonActive(shop: ShopForSeoCheck): boolean {
  if (process.env.SEO_ADDON_DEV === "true") {
    const testShop = process.env.SEO_ADDON_TEST_SHOP;
    // If no specific test shop is set, bypass for ALL shops (broad dev mode).
    // If a test shop is set, only bypass for that one — everyone else stays gated.
    if (!testShop || shop.shopDomain === testShop) {
      return true;
    }
  }
  return shop.seoAddonActive;
}

/**
 * Use in API routes to reject requests from shops without the add-on.
 * Returns a 403 Response if not active, or null if the shop can proceed.
 *
 * Usage:
 *   const gate = seoAddonGate(shop);
 *   if (gate) return gate;
 */
export function seoAddonGate(shop: ShopForSeoCheck): Response | null {
  if (!isSeoAddonActive(shop)) {
    return Response.json(
      { error: "Fabric SEO Engine add-on is not active for this shop." },
      { status: 403 }
    );
  }
  return null;
}
