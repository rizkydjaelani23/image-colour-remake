/**
 * Webhook: app_subscriptions/update
 *
 * Fires whenever a Shopify app subscription changes status —
 * cancelled, reactivated, expired, etc.
 *
 * We use this to keep shop.seoAddonActive in sync with Shopify's
 * billing state so merchants lose access the moment they cancel.
 *
 * Payload shape (REST webhook):
 *   {
 *     "app_subscription": {
 *       "admin_graphql_api_id": "gid://shopify/AppSubscription/123",
 *       "name": "Fabric SEO Engine",
 *       "status": "cancelled"   // lowercase in REST webhooks
 *     }
 *   }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

type SubscriptionPayload = {
  app_subscription?: {
    admin_graphql_api_id?: string;
    name?: string;
    status?: string; // "active" | "cancelled" | "declined" | "expired" | "frozen"
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const subPayload = (payload as SubscriptionPayload)?.app_subscription;
  if (!subPayload) return new Response();

  // Only care about our SEO add-on
  if (subPayload.name !== "Fabric SEO Engine") return new Response();

  const isActive = subPayload.status === "active";

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      console.warn(`SEO subscription webhook: shop not found — ${shop}`);
      return new Response();
    }

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        seoAddonActive: isActive,
        // Clear the subscription GID when cancelled so it's clean if they re-subscribe
        ...(isActive
          ? { seoAddonSubscriptionId: subPayload.admin_graphql_api_id ?? null }
          : { seoAddonSubscriptionId: null }),
      },
    });

    console.log(
      `SEO add-on ${isActive ? "re-activated" : "deactivated"} for ${shop} — status: ${subPayload.status}`,
    );
  } catch (error) {
    console.error("SEO subscription webhook error:", error);
  }

  return new Response();
};
