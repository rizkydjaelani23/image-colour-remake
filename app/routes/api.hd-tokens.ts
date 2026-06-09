/**
 * GET /api/hd-tokens
 *
 * Returns the calling shop's HD render token status, syncing the monthly limit
 * from the current Shopify plan first (so an upgrade is reflected immediately).
 *
 * Response: { used, limit, extra, available, enabled }
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../utils/shop.server";
import { getCurrentBillingPlan } from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";
import { getHdTokenStatus } from "../utils/hd-tokens.server";
import { isFluxEnabled } from "../utils/generation-flux.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  const shop = await getOrCreateShop(session.shop);
  const { hdTokenLimit, apiSucceeded } = await getCurrentBillingPlan(admin);

  await syncShopUsage({
    shopId:            shop.id,
    previewLimit:      0,            // unchanged here
    hdTokenLimit,
    resetExpiredCycle: true,
    updateLimit:       apiSucceeded,
  });

  const status = await getHdTokenStatus(shop.id);

  return Response.json({
    ...status,            // used, limit, extra, available
    enabled: isFluxEnabled(),
  });
}
