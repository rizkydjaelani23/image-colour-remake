import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);

  const response = await billing.request({
    plan: "Pro Plan",
    isTest: true, // IMPORTANT: set false when live
    lineItems: [
      {
        price: {
          amount: 29,
          currencyCode: "USD",
        },
        interval: "EVERY_30_DAYS",
      },
    ],
    returnUrl: "/app",
  });

  return Response.redirect(response.confirmationUrl);
}