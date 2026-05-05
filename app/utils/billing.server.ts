const DEFAULT_SHOPIFY_APP_HANDLE = "image-colour-remake-2";
export const FREE_PREVIEW_LIMIT = 50;
export const PRO_PREVIEW_LIMIT = 999999;

type ShopifyAdminClient = {
  graphql: (query: string) => Promise<Response>;
};

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

    const activeSub = subs.find(
      (subscription: { status: string }) => subscription.status === "ACTIVE",
    );

    if (activeSub) {
      planName = activeSub.name || "Pro";
      previewLimit = PRO_PREVIEW_LIMIT;
    }
  } catch (error) {
    console.error("Failed to check subscription:", error);
  }

  return { planName, previewLimit };
}
