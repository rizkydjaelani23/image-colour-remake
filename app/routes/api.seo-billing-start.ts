/**
 * POST /api/seo-billing-start
 *
 * Creates a Shopify recurring app subscription for the Fabric SEO Engine add-on
 * and returns the Shopify billing confirmation URL as JSON.
 *
 * The client navigates window.top to the confirmationUrl so the merchant can
 * approve the charge on Shopify's hosted billing page.
 *
 * After approval, Shopify redirects back to /api/seo-billing-return.
 *
 * Price: controlled by the SEO_ADDON_PRICE env var (default $9.99/month).
 * To change the price: update SEO_ADDON_PRICE in Railway env vars and redeploy.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const SEO_ADDON_PRICE = process.env.SEO_ADDON_PRICE ?? "9.99";
const APP_URL =
  process.env.SHOPIFY_APP_URL ??
  "https://image-colour-remake-production.up.railway.app";

// GraphQL mutation — price is injected at module-load time from env var
const CREATE_SUBSCRIPTION = `#graphql
  mutation seoAddonSubscribe($returnUrl: URL!) {
    appSubscriptionCreate(
      name: "Fabric SEO Engine"
      returnUrl: $returnUrl
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: "${SEO_ADDON_PRICE}", currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin } = await authenticate.admin(request);
    const returnUrl = `${APP_URL}/api/seo-billing-return`;

    const res = await admin.graphql(CREATE_SUBSCRIPTION, {
      variables: { returnUrl },
    });

    const json = (await res.json()) as {
      data?: {
        appSubscriptionCreate?: {
          appSubscription?: { id: string; status: string };
          confirmationUrl?: string;
          userErrors?: Array<{ field: string; message: string }>;
        };
      };
    };

    const result = json?.data?.appSubscriptionCreate;
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      const msg = userErrors.map((e) => e.message).join("; ");
      console.error("SEO billing userErrors:", userErrors);
      return Response.json({ error: msg }, { status: 400 });
    }

    if (!result?.confirmationUrl) {
      return Response.json(
        { error: "No confirmation URL returned from Shopify" },
        { status: 500 },
      );
    }

    return Response.json({ confirmationUrl: result.confirmationUrl });
  } catch (error) {
    console.error("SEO billing start error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
