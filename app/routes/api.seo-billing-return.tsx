/**
 * GET /api/seo-billing-return
 *
 * Return URL after a merchant approves (or declines) the Fabric SEO Engine
 * add-on subscription on Shopify's hosted billing page.
 *
 * Shopify redirects here with ?shop=...&host=...&charge_id=... appended.
 * authenticate.admin handles re-embedding the app in the iframe.
 *
 * Flow:
 *   1. Query currentAppInstallation.activeSubscriptions to find an active
 *      "Fabric SEO Engine" subscription (avoids parsing the charge_id GID).
 *   2. If found → set shop.seoAddonActive = true and store the subscription GID.
 *   3. Redirect to /app/seo in all cases (approved or declined).
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

const CHECK_SUBSCRIPTIONS = `#graphql
  {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, redirect } = await authenticate.admin(request);

  try {
    const shop = await getOrCreateShop(session.shop);

    const res = await admin.graphql(CHECK_SUBSCRIPTIONS);
    const json = (await res.json()) as {
      data?: {
        currentAppInstallation?: {
          activeSubscriptions?: Array<{ id: string; name: string; status: string }>;
        };
      };
    };

    const subs = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const SEO_PLANS = ["Fabric SEO Engine", "Pro + SEO Engine"];
    const seoSub = subs.find(
      (s) => SEO_PLANS.includes(s.name) && s.status === "ACTIVE",
    );

    if (seoSub) {
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          seoAddonActive:       true,
          seoAddonSubscriptionId: seoSub.id,
          // Only stamp activatedAt on first activation, not re-subscribes
          seoAddonActivatedAt:  shop.seoAddonActivatedAt ?? new Date(),
        },
      });
      console.log(`SEO add-on activated for ${session.shop} — sub: ${seoSub.id}`);
    } else {
      console.log(
        `SEO billing return for ${session.shop} — no active SEO subscription found (merchant may have declined)`,
      );
    }
  } catch (error) {
    // Log but don't crash — redirect the merchant to the SEO page either way
    console.error("SEO billing return error:", error);
  }

  return redirect("/app/seo");
}

// This route always redirects in the loader — the component never renders.
export default function SeoBillingReturn() {
  return null;
}
