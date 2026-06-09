const DEFAULT_SHOPIFY_APP_HANDLE = "image-colour-remake-2";
export const FREE_PREVIEW_LIMIT = 50;
export const PRO_PREVIEW_LIMIT = 999999;

// ── HD (FLUX) render token allocations, per billing cycle ─────────────────────
// 1 token = 1 HD render (~$0.04 fal.ai cost). These are the monthly INCLUDED
// amounts; merchants buy top-up packs for more (hdTokensExtra). Tuned so HD
// cost stays a small fraction of plan revenue.
export const FREE_HD_TOKENS    = 3;    // taster
export const PRO_HD_TOKENS     = 100;  // Pro $29.99 → ~$4/mo fal cost (13%)
export const PRO_SEO_HD_TOKENS = 150;  // Pro + SEO $44.99 → ~$6/mo fal cost

/** Monthly included HD tokens for a given Shopify plan name. */
export function getHdTokenLimitForPlan(planName: string | null | undefined): number {
  const n = (planName || "").trim().toLowerCase();
  if (isFreePlanName(planName)) return FREE_HD_TOKENS;
  if (n.includes("seo"))        return PRO_SEO_HD_TOKENS;
  return PRO_HD_TOKENS; // any other active paid plan
}

type ShopifyAdminClient = {
  graphql: (query: string) => Promise<Response>;
};

function isFreePlanName(planName: string | null | undefined) {
  const normalizedName = (planName || "").trim().toLowerCase();

  return normalizedName === "free" || normalizedName === "free plan";
}

export function getStoreHandle(shopDomain: string) {
  const normalizedShop = shopDomain.trim().toLowerCase();
  const myshopifySuffix = ".myshopify.com";

  if (normalizedShop.endsWith(myshopifySuffix)) {
    return normalizedShop.slice(0, -myshopifySuffix.length);
  }

  return normalizedShop.split(".")[0];
}

export function getShopifyAppHandle() {
  return (
    process.env.SHOPIFY_APP_HANDLE?.trim() || DEFAULT_SHOPIFY_APP_HANDLE
  );
}

export function getManagedPricingUrl(shopDomain: string) {
  const storeHandle = encodeURIComponent(getStoreHandle(shopDomain));
  const appHandle = encodeURIComponent(getShopifyAppHandle());

  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

export async function getCurrentBillingPlan(admin: ShopifyAdminClient) {
  let planName = "Free";
  let previewLimit = FREE_PREVIEW_LIMIT;
  let hdTokenLimit = FREE_HD_TOKENS;
  let apiSucceeded = false;

  try {
    const subscriptionResponse = await admin.graphql(`
      {
        currentAppInstallation {
          activeSubscriptions {
            name
            status
          }
        }
      }
    `);

    const subscriptionData = await subscriptionResponse.json();
    const subs =
      subscriptionData?.data?.currentAppInstallation?.activeSubscriptions || [];

    apiSucceeded = true; // GraphQL responded — data is trustworthy

    const activeSub = subs.find(
      (subscription: { status: string }) => subscription.status === "ACTIVE",
    );

    if (activeSub && !isFreePlanName(activeSub.name)) {
      planName = activeSub.name || "Pro";
      previewLimit = PRO_PREVIEW_LIMIT;
    }
    hdTokenLimit = getHdTokenLimitForPlan(planName);
  } catch (error) {
    console.error("Failed to check subscription:", error);
    // apiSucceeded stays false — caller should not overwrite the cached DB limit
  }

  return { planName, previewLimit, hdTokenLimit, apiSucceeded };
}
