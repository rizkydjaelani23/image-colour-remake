/**
 * Fabric SEO Engine — automated Shopify collection utility
 *
 * Creates one automated collection per fabric colour.
 *
 * Collection contract:
 *   - Handle: `fabric-{colour-slug}` e.g. `fabric-plush-blue`
 *   - URL:    /collections/fabric-plush-blue
 *   - Rule:   TAG equals "fabric-plush-blue"  (matches our product tags)
 *   - Published: true — live, Google-indexable, NOT in navigation by default
 *
 * Collections are created idempotent — if one already exists (checked by handle)
 * it is left untouched. Only missing ones are created.
 *
 * Navigation: Shopify collections created via API do not automatically appear
 * in store navigation. Merchants must manually add them if they want them visible.
 * The SEO value comes from Google crawling the URL directly — navigation not needed.
 */

import { colourToSlug, colourToCollectionHandle } from "./colour";

// ── Types ────────────────────────────────────────────────────────────────────

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type CollectionResult = {
  colourName:       string;
  handle:           string;
  url:              string;
  created:          boolean;  // true = just created, false = already existed
  error?:           string;
};

// ── GraphQL ──────────────────────────────────────────────────────────────────

const COLLECTION_CREATE = `#graphql
  mutation createFabricCollection($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Creates automated Shopify collection pages for an array of colour names.
 * Skips colours whose collection handle already exists.
 *
 * Uses GraphQL field aliasing to batch-check all handles in one query,
 * then creates only the missing ones sequentially.
 *
 * @param shopDomain e.g. "everest-beds.myshopify.com" — used to construct URLs
 */
export async function ensureFabricCollections(
  admin:       AdminGraphql,
  colourNames: string[],
  shopDomain:  string,
): Promise<CollectionResult[]> {
  // Deduplicate
  const unique = [...new Set(colourNames)].filter(Boolean);
  if (unique.length === 0) return [];

  // ── 1. Batch-check which collections already exist ────────────────────────
  // GraphQL aliasing lets us check many handles in one round-trip.
  // Alias format: col_0, col_1, ... (must be valid GraphQL identifiers)
  const aliasLines = unique.map((name, i) => {
    const handle = colourToCollectionHandle(name);
    // Escape the handle value (handles are alphanumeric + hyphens — safe)
    return `col_${i}: collectionByHandle(handle: "${handle}") { id }`;
  });

  let existingById: Record<string, { id: string } | null> = {};
  try {
    const checkRes  = await admin.graphql(`#graphql query checkFabricCollections { ${aliasLines.join("\n")} }`);
    const checkJson = await checkRes.json() as { data?: Record<string, { id: string } | null> };
    existingById = checkJson?.data ?? {};
  } catch (error) {
    console.error("ensureFabricCollections batch check error:", error);
    // Continue — we'll try to create everything and let Shopify reject duplicates
  }

  // ── 2. Create missing collections sequentially ────────────────────────────
  const results: CollectionResult[] = [];

  for (let i = 0; i < unique.length; i++) {
    const name   = unique[i];
    const slug   = colourToSlug(name);
    const handle = colourToCollectionHandle(name);
    const tag    = `fabric-${slug}`;
    const url    = `https://${shopDomain}/collections/${handle}`;

    // Already exists — skip
    if (existingById[`col_${i}`]?.id) {
      results.push({ colourName: name, handle, url, created: false });
      continue;
    }

    // Create it
    try {
      const createRes  = await admin.graphql(COLLECTION_CREATE, {
        variables: {
          input: {
            title:       name,
            handle,
            // Automated collection rule: pulls all products tagged `fabric-{slug}`
            ruleSet: {
              appliedDisjunctively: false,
              rules: [
                { column: "TAG", relation: "EQUALS", condition: tag },
              ],
            },
            // SEO title + description for the collection page itself
            seo: {
              title:       `${name} Furniture`,
              description: `Browse all furniture available in ${name}. Shop our full range of ${name} sofas, beds, chairs and more.`,
            },
            // Note: collections created via API are published (online store) by default.
            // There is no "published" field on CollectionInput in the GraphQL API.
          },
        },
      });

      const createJson = await createRes.json() as {
        data?: {
          collectionCreate?: {
            collection?: { id: string; handle: string };
            userErrors?: Array<{ field: string; message: string }>;
          };
        };
      };

      const userErrors = createJson?.data?.collectionCreate?.userErrors ?? [];
      if (userErrors.length > 0) {
        const msg = userErrors.map((e) => e.message).join("; ");
        console.error(`Collection create error for "${name}":`, userErrors);
        results.push({ colourName: name, handle, url, created: false, error: msg });
      } else {
        results.push({ colourName: name, handle, url, created: true });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`Collection create exception for "${name}":`, error);
      results.push({ colourName: name, handle, url, created: false, error: msg });
    }
  }

  return results;
}
