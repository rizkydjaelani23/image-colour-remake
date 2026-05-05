import type { ActionFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { getManagedPricingUrl } from "../utils/billing.server";

export const action: ActionFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return Response.json({
    ok: true,
    managedPricingUrl: getManagedPricingUrl(session.shop),
    message:
      "This app uses Shopify Managed Pricing. Redirect merchants to managedPricingUrl; do not create charges with the Billing API.",
  });
};
