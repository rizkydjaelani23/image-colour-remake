/**
 * Fabric SEO Engine — metafield utility
 *
 * Writes (or removes) the `power_your_house.fabric_colours` metafield on a
 * Shopify product whenever its set of approved previews changes.
 *
 * The metafield value format is:
 *   "Available fabric colours: Silver Velvet, Plush Blue, Mink Chenille"
 *
 * This is the machine-readable signal Shopify uses for rich snippet eligibility
 * and can also be surfaced in product descriptions via liquid.
 *
 * Safe to call fire-and-forget: all errors are caught and logged so they never
 * interrupt image generation or upload.
 */

import prisma from "./db.server";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal admin API shape — compatible with the object returned by authenticate.admin() */
type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// ── Metafield mutation ───────────────────────────────────────────────────────

const METAFIELDS_SET_MUTATION = `#graphql
  mutation setFabricColoursMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch all currently-approved colours for a product from our DB and write
 * them to the Shopify `power_your_house.fabric_colours` metafield.
 *
 * @param admin          Shopify admin API object (from authenticate.admin)
 * @param shopifyProductId  The Shopify product GID, e.g. "gid://shopify/Product/123"
 * @param productId      Internal DB product id (used to query Prisma)
 */
export async function updateFabricColoursMetafield(
  admin: AdminGraphql,
  shopifyProductId: string,
  productId: number,
): Promise<void> {
  try {
    // ── 1. Fetch all approved, visible previews for this product ──────────
    const previews = await prisma.preview.findMany({
      where: {
        productId,
        approvedForStorefront: true,
        NOT: { status: "HIDDEN" },
      },
      select: {
        colourName:          true,
        customerDisplayName: true,
        fabricFamily:        true,
      },
      orderBy: [
        { fabricFamily: "asc" },
        { colourName:   "asc" },
      ],
    });

    if (previews.length === 0) {
      // No approved previews yet — nothing to write.
      // (We intentionally don't delete an existing metafield here; it may have
      //  been set by a previous approval that was later toggled off individually.
      //  The full sync route handles cleanup when merchants want it.)
      return;
    }

    // ── 2. Build deduplicated colour list ─────────────────────────────────
    // Use customerDisplayName when available (the storefront-facing label).
    const seen = new Set<string>();
    const colourNames: string[] = [];
    for (const p of previews) {
      const name = p.customerDisplayName || p.colourName;
      if (!seen.has(name)) {
        seen.add(name);
        colourNames.push(name);
      }
    }

    const metafieldValue = `Available fabric colours: ${colourNames.join(", ")}`;

    // ── 3. Write to Shopify ───────────────────────────────────────────────
    const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
      variables: {
        metafields: [
          {
            ownerId:   shopifyProductId,
            namespace: "power_your_house",
            key:       "fabric_colours",
            value:     metafieldValue,
            type:      "single_line_text_field",
          },
        ],
      },
    });

    // Surface any GraphQL user-errors in logs (non-fatal)
    try {
      const json = await response.json() as {
        data?: {
          metafieldsSet?: {
            userErrors?: Array<{ field: string; message: string }>;
          };
        };
      };
      const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
      if (userErrors.length > 0) {
        console.error(
          `updateFabricColoursMetafield userErrors for product ${shopifyProductId}:`,
          userErrors,
        );
      }
    } catch {
      // response already consumed — ignore parse errors here
    }
  } catch (error) {
    // Never let a metafield update crash generation / upload
    console.error("updateFabricColoursMetafield error:", error);
  }
}

// ── Batch helper (used by the SEO sync route) ────────────────────────────────

export type ProductMetafieldInput = {
  shopifyProductId: string;
  colourNames:      string[];
};

/**
 * Write fabric_colours metafields for up to 25 products in a single GraphQL call.
 * Skips products with no colour names.
 *
 * @returns Number of metafields actually written
 */
export async function batchUpdateFabricColoursMetafields(
  admin:    AdminGraphql,
  products: ProductMetafieldInput[],
): Promise<number> {
  // Filter out products with no approved colours (nothing to write)
  const toWrite = products.filter((p) => p.colourNames.length > 0);
  if (toWrite.length === 0) return 0;

  const metafields = toWrite.map((p) => ({
    ownerId:   p.shopifyProductId,
    namespace: "power_your_house",
    key:       "fabric_colours",
    value:     `Available fabric colours: ${p.colourNames.join(", ")}`,
    type:      "single_line_text_field",
  }));

  try {
    const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
      variables: { metafields },
    });

    try {
      const json = await response.json() as {
        data?: {
          metafieldsSet?: {
            userErrors?: Array<{ field: string; message: string }>;
          };
        };
      };
      const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
      if (userErrors.length > 0) {
        console.error("batchUpdateFabricColoursMetafields userErrors:", userErrors);
      }
    } catch {
      // ignore parse errors
    }

    return toWrite.length;
  } catch (error) {
    console.error("batchUpdateFabricColoursMetafields error:", error);
    return 0;
  }
}
