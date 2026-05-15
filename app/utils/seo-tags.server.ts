/**
 * Fabric SEO Engine — product tag utility
 *
 * Writes and removes `fabric-{colour-slug}` tags on Shopify products.
 *
 * Tag contract:
 *   - We ONLY touch tags that start with "fabric-"
 *   - Merchant's own tags are never modified
 *   - Tags are synced to match the current approved colour set for each product
 *   - Removing all approved colours for a product removes all fabric tags from it
 *
 * These tags are what drive Shopify's automated collection pages:
 *   Shopify collection rule: TAG equals "fabric-plush-blue"
 *   → All products with that tag appear in /collections/fabric-plush-blue
 */

import prisma from "./db.server";
import { colourToFabricTag } from "./colour";

// ── Types ────────────────────────────────────────────────────────────────────

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// ── GraphQL fragments ────────────────────────────────────────────────────────

const GET_PRODUCT_TAGS = `#graphql
  query getProductTags($id: ID!) {
    product(id: $id) {
      id
      tags
    }
  }
`;

const TAGS_ADD = `#graphql
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

const TAGS_REMOVE = `#graphql
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

// ── Single-product update ────────────────────────────────────────────────────

/**
 * Syncs `fabric-*` tags on a Shopify product to match the product's
 * currently-approved colour set in our DB.
 *
 * Safe to call fire-and-forget — all errors caught and logged.
 */
export async function updateFabricTags(
  admin:            AdminGraphql,
  shopifyProductId: string,
  productId:        number,
): Promise<void> {
  try {
    // ── 1. Desired tags — from approved colours in DB ─────────────────────
    const previews = await prisma.preview.findMany({
      where: {
        productId,
        approvedForStorefront: true,
        NOT: { status: "HIDDEN" },
      },
      select: { colourName: true, customerDisplayName: true },
    });

    const desiredTags = new Set(
      previews.map((p) => colourToFabricTag(p.customerDisplayName || p.colourName)),
    );

    // ── 2. Current tags on Shopify product ────────────────────────────────
    const tagRes  = await admin.graphql(GET_PRODUCT_TAGS, { variables: { id: shopifyProductId } });
    const tagJson = await tagRes.json() as { data?: { product?: { tags?: string[] } } };
    const currentTags: string[] = tagJson?.data?.product?.tags ?? [];

    // Only diff within the `fabric-` namespace — never touch merchant tags
    const currentFabricTags = new Set(currentTags.filter((t) => t.startsWith("fabric-")));

    const toAdd    = [...desiredTags].filter((t) => !currentFabricTags.has(t));
    const toRemove = [...currentFabricTags].filter((t) => !desiredTags.has(t));

    // ── 3. Apply changes ──────────────────────────────────────────────────
    if (toAdd.length > 0) {
      const addRes  = await admin.graphql(TAGS_ADD, { variables: { id: shopifyProductId, tags: toAdd } });
      const addJson = await addRes.json() as { data?: { tagsAdd?: { userErrors?: Array<{ field: string; message: string }> } } };
      const addErrors = addJson?.data?.tagsAdd?.userErrors ?? [];
      if (addErrors.length) console.error(`tagsAdd errors for ${shopifyProductId}:`, addErrors);
    }

    if (toRemove.length > 0) {
      const remRes  = await admin.graphql(TAGS_REMOVE, { variables: { id: shopifyProductId, tags: toRemove } });
      const remJson = await remRes.json() as { data?: { tagsRemove?: { userErrors?: Array<{ field: string; message: string }> } } };
      const remErrors = remJson?.data?.tagsRemove?.userErrors ?? [];
      if (remErrors.length) console.error(`tagsRemove errors for ${shopifyProductId}:`, remErrors);
    }
  } catch (error) {
    console.error("updateFabricTags error:", error);
  }
}

// ── Batch helper (used by sync route) ────────────────────────────────────────

export type TagSyncProduct = {
  shopifyProductId: string;
  productId:        number;
};

/**
 * Syncs fabric tags for multiple products sequentially.
 * Sequential (not parallel) to avoid Shopify rate limit bursts.
 *
 * @returns Number of products processed
 */
export async function batchUpdateFabricTags(
  admin:    AdminGraphql,
  products: TagSyncProduct[],
): Promise<number> {
  let count = 0;
  for (const p of products) {
    await updateFabricTags(admin, p.shopifyProductId, p.productId);
    count++;
  }
  return count;
}
