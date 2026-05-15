/**
 * Fabric SEO Engine — cleanup utility
 *
 * Removes all SEO data that the Fabric SEO Engine wrote to a merchant's
 * Shopify store. Called when a merchant disables the SEO add-on or
 * wants a clean uninstall.
 *
 * Three operations — each is safe to run independently:
 *   1. clearFabricMetafields  — removes power_your_house.fabric_colours from products
 *   2. clearFabricTags        — removes all fabric-* tags from products
 *   3. deleteFabricCollections — deletes all fabric-* automated collection pages
 *
 * Alt text on gallery images does NOT need cleanup here — it is rendered by
 * gallery.js at runtime. When the theme extension block is removed (on uninstall),
 * gallery.js stops running and the alt text simply ceases to be rendered.
 *
 * All functions are fire-safe: errors are logged but never re-thrown, and
 * partial success is returned so the caller can report progress.
 */

import { colourToSlug, colourToFabricTag, colourToCollectionHandle } from "./colour";

// ── Types ────────────────────────────────────────────────────────────────────

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// ── 1. Clear metafields ───────────────────────────────────────────────────────

const METAFIELDS_DELETE = `#graphql
  mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace }
      userErrors { field message }
    }
  }
`;

/**
 * Deletes the `power_your_house.fabric_colours` metafield from every product.
 * Batches 25 products per GraphQL call (Shopify limit).
 *
 * @returns Number of products whose metafield was cleared
 */
export async function clearFabricMetafields(
  admin:             AdminGraphql,
  shopifyProductIds: string[],
): Promise<number> {
  if (shopifyProductIds.length === 0) return 0;

  const BATCH = 25;
  let cleared = 0;

  for (let i = 0; i < shopifyProductIds.length; i += BATCH) {
    const batch = shopifyProductIds.slice(i, i + BATCH);
    const metafields = batch.map((ownerId) => ({
      ownerId,
      namespace: "power_your_house",
      key:       "fabric_colours",
    }));

    try {
      const res  = await admin.graphql(METAFIELDS_DELETE, { variables: { metafields } });
      const json = await res.json() as {
        data?: {
          metafieldsDelete?: {
            deletedMetafields?: Array<{ key: string; namespace: string }>;
            userErrors?:         Array<{ field: string; message: string }>;
          };
        };
      };
      const userErrors = json?.data?.metafieldsDelete?.userErrors ?? [];
      if (userErrors.length) console.error("clearFabricMetafields userErrors:", userErrors);
      cleared += json?.data?.metafieldsDelete?.deletedMetafields?.length ?? 0;
    } catch (error) {
      console.error("clearFabricMetafields batch error:", error);
    }
  }

  return cleared;
}

// ── 2. Clear product tags ─────────────────────────────────────────────────────

const TAGS_REMOVE = `#graphql
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

/**
 * Removes all `fabric-*` tags from every product.
 *
 * We compute the full set of fabric tags from the colour list and pass them
 * to `tagsRemove` per product — Shopify silently ignores tags that don't
 * exist on that product, so no pre-read is required.
 *
 * Sequential (not parallel) to avoid rate-limit bursts on large catalogs.
 *
 * @param shopifyProductIds  All product GIDs to process
 * @param allColourNames     All colour names that may have been tagged
 * @returns Number of products processed
 */
export async function clearFabricTags(
  admin:             AdminGraphql,
  shopifyProductIds: string[],
  allColourNames:    string[],
): Promise<number> {
  if (shopifyProductIds.length === 0 || allColourNames.length === 0) {
    return 0;
  }

  // Build the complete list of fabric tags we ever wrote
  const fabricTags = [...new Set(allColourNames.map(colourToFabricTag))];
  let processed = 0;

  for (const id of shopifyProductIds) {
    try {
      const res  = await admin.graphql(TAGS_REMOVE, { variables: { id, tags: fabricTags } });
      const json = await res.json() as {
        data?: { tagsRemove?: { userErrors?: Array<{ field: string; message: string }> } };
      };
      const userErrors = json?.data?.tagsRemove?.userErrors ?? [];
      if (userErrors.length) console.error(`clearFabricTags errors for ${id}:`, userErrors);
      processed++;
    } catch (error) {
      console.error(`clearFabricTags error for ${id}:`, error);
    }
  }

  return processed;
}

// ── 3. Delete collections ─────────────────────────────────────────────────────

const COLLECTION_DELETE = `#graphql
  mutation collectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors { field message }
    }
  }
`;

/**
 * Deletes all automated Shopify collection pages that the SEO Engine created.
 *
 * We check each expected handle using GraphQL aliases in one query, then
 * delete the ones that actually exist sequentially.
 *
 * @param colourNames  All colour names whose collections may exist
 * @returns Number of collections deleted
 */
export async function deleteFabricCollections(
  admin:       AdminGraphql,
  colourNames: string[],
): Promise<number> {
  const unique = [...new Set(colourNames)].filter(Boolean);
  if (unique.length === 0) return 0;

  // ── Batch-check existence ─────────────────────────────────────────────────
  const aliasLines = unique.map((name, i) => {
    const handle = colourToCollectionHandle(name);
    return `col_${i}: collectionByHandle(handle: "${handle}") { id handle }`;
  });

  let existingData: Record<string, { id: string; handle: string } | null> = {};
  try {
    const checkRes  = await admin.graphql(
      `#graphql query checkFabricCollectionsForDelete { ${aliasLines.join("\n")} }`,
    );
    const checkJson = await checkRes.json() as {
      data?: Record<string, { id: string; handle: string } | null>;
    };
    existingData = checkJson?.data ?? {};
  } catch (error) {
    console.error("deleteFabricCollections check error:", error);
    return 0;
  }

  // ── Delete found collections ──────────────────────────────────────────────
  let deleted = 0;

  for (let i = 0; i < unique.length; i++) {
    const entry = existingData[`col_${i}`];
    if (!entry?.id) continue; // doesn't exist — skip

    try {
      const res  = await admin.graphql(COLLECTION_DELETE, {
        variables: { input: { id: entry.id } },
      });
      const json = await res.json() as {
        data?: {
          collectionDelete?: {
            deletedCollectionId?: string;
            userErrors?:          Array<{ field: string; message: string }>;
          };
        };
      };
      const userErrors = json?.data?.collectionDelete?.userErrors ?? [];
      if (userErrors.length) {
        console.error(`deleteFabricCollections errors for ${entry.handle}:`, userErrors);
      } else if (json?.data?.collectionDelete?.deletedCollectionId) {
        deleted++;
      }
    } catch (error) {
      console.error(`deleteFabricCollections error for ${entry.handle}:`, error);
    }
  }

  return deleted;
}
