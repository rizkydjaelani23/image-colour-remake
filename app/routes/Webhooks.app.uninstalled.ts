/**
 * Webhook: app/uninstalled
 *
 * Fires when a merchant uninstalls the app from their Shopify store.
 *
 * ⚠️  Important: By the time this webhook fires, Shopify has already
 *     revoked the OAuth access token. We CANNOT make Admin API calls here
 *     (no valid token). Shopify-side cleanup (metafields, tags, collections)
 *     must be done while the app is still installed via the "Disable SEO"
 *     button on the SEO Engine dashboard.
 *
 * What we DO here:
 *   1. Delete all Shopify sessions from our DB for this shop
 *   2. Delete the Shop record — this cascades to ALL related data:
 *        Products → Zones → Previews → Swatches → ShopUsage → SupportConversations
 *
 * The merchant's Shopify store retains any metafields/tags/collections that
 * were not cleaned up before uninstall. These are harmless — no app code
 * is running to regenerate them. They can be cleaned up by re-installing
 * and using the "Disable SEO" feature.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await authenticate.webhook(request);

    // Run both deletes in parallel — sessions and shop record are independent
    await Promise.all([
      // Sessions — keyed by shop domain string (no FK relation)
      prisma.session.deleteMany({ where: { shop } }),

      // Shop record — cascades to Products, Previews, Zones, Swatches,
      // ShopUsage, and SupportConversations/Messages via onDelete: Cascade
      prisma.shop.delete({ where: { shopDomain: shop } }).catch((err) => {
        // If the shop was never created in our DB (e.g., auth error during install)
        // the delete will throw a "Record to delete does not exist" error — that's fine.
        if (err?.code !== "P2025") {
          console.error("webhooks.app.uninstalled — shop delete error:", err);
        }
      }),
    ]);

    console.log(`App uninstalled and all data purged for shop: ${shop}`);
    return new Response(null, { status: 200 });

  } catch (error) {
    console.error("App uninstall webhook failed:", error);
    return new Response("Unauthorized", { status: 401 });
  }
}
