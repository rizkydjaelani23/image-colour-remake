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
 *
 * Publishing: CollectionInput has no "published" field — collectionCreate alone
 * leaves a collection unpublished (verified against a live store; an earlier
 * version of this file assumed otherwise, which meant every collection this
 * function created was invisible on the storefront until someone found and
 * fixed it by hand). We explicitly call publishablePublish to the "Online
 * Store" channel right after creation. Requires read_publications +
 * write_publications (see shopify.app.toml).
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
  published:        boolean;  // true = confirmed published to Online Store
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

const GET_ONLINE_STORE_PUBLICATION = `#graphql
  query getOnlineStorePublication {
    publications(first: 20) {
      nodes { id name }
    }
  }
`;

const PUBLISHABLE_PUBLISH = `#graphql
  mutation publishFabricCollection($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

/**
 * Looks up the "Online Store" sales channel's publication id. Cached per
 * process — this doesn't change for a shop while the app is running.
 */
let onlineStorePublicationIdCache: Map<string, string> = new Map();

async function getOnlineStorePublicationId(
  admin: AdminGraphql,
  shopDomain: string,
): Promise<string | null> {
  const cached = onlineStorePublicationIdCache.get(shopDomain);
  if (cached) return cached;

  try {
    const res  = await admin.graphql(GET_ONLINE_STORE_PUBLICATION);
    const json = await res.json() as {
      data?: { publications?: { nodes?: Array<{ id: string; name: string }> } };
    };
    const nodes = json?.data?.publications?.nodes ?? [];
    const onlineStore = nodes.find((n) => n.name === "Online Store");
    if (!onlineStore) return null;
    onlineStorePublicationIdCache.set(shopDomain, onlineStore.id);
    return onlineStore.id;
  } catch (error) {
    console.error("getOnlineStorePublicationId error:", error);
    return null;
  }
}

/**
 * Publishes a collection to the Online Store channel. Best-effort — logs and
 * returns false on failure rather than throwing, so a publish hiccup never
 * blocks the rest of the sync. ensureFabricCollections re-checks publish state
 * on every call (not just at creation time), so a failure here gets retried
 * automatically on the next sync.
 */
async function publishCollection(
  admin: AdminGraphql,
  shopDomain: string,
  collectionId: string,
): Promise<boolean> {
  const publicationId = await getOnlineStorePublicationId(admin, shopDomain);
  if (!publicationId) {
    console.error(`publishCollection: could not resolve Online Store publication id for ${shopDomain}`);
    return false;
  }

  try {
    const res  = await admin.graphql(PUBLISHABLE_PUBLISH, {
      variables: { id: collectionId, input: [{ publicationId }] },
    });
    const json = await res.json() as {
      data?: { publishablePublish?: { userErrors?: Array<{ field: string; message: string }> } };
    };
    const userErrors = json?.data?.publishablePublish?.userErrors ?? [];
    if (userErrors.length) {
      console.error(`publishCollection userErrors for ${collectionId}:`, userErrors);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`publishCollection error for ${collectionId}:`, error);
    return false;
  }
}

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

  // Resolve the Online Store publication id once, up front — used both to
  // check existing collections' publish state and to publish new ones.
  const publicationId = await getOnlineStorePublicationId(admin, shopDomain);

  // ── 1. Batch-check which collections already exist, and whether each is
  //      published to Online Store ────────────────────────────────────────
  // GraphQL aliasing lets us check many handles in one round-trip.
  // Alias format: col_0, col_1, ... (must be valid GraphQL identifiers)
  const aliasLines = unique.map((name, i) => {
    const handle = colourToCollectionHandle(name);
    // Escape the handle value (handles are alphanumeric + hyphens — safe)
    const publishedField = publicationId
      ? `publishedOnPublication(publicationId: "${publicationId}")`
      : "";
    return `col_${i}: collectionByHandle(handle: "${handle}") { id ${publishedField} }`;
  });

  let existingById: Record<string, { id: string; publishedOnPublication?: boolean } | null> = {};
  try {
    const checkRes  = await admin.graphql(`#graphql query checkFabricCollections { ${aliasLines.join("\n")} }`);
    const checkJson = await checkRes.json() as {
      data?: Record<string, { id: string; publishedOnPublication?: boolean } | null>;
    };
    existingById = checkJson?.data ?? {};
  } catch (error) {
    console.error("ensureFabricCollections batch check error:", error);
    // Continue — we'll try to create everything and let Shopify reject duplicates
  }

  // ── 2. Create missing collections, repair unpublished existing ones ───────
  const results: CollectionResult[] = [];

  for (let i = 0; i < unique.length; i++) {
    const name   = unique[i];
    const slug   = colourToSlug(name);
    const handle = colourToCollectionHandle(name);
    const tag    = `fabric-${slug}`;
    const url    = `https://${shopDomain}/collections/${handle}`;
    const existing = existingById[`col_${i}`];

    // Already exists — repair its publish state if we can tell it's off,
    // otherwise leave it untouched (idempotent).
    if (existing?.id) {
      if (existing.publishedOnPublication === false) {
        const published = await publishCollection(admin, shopDomain, existing.id);
        results.push({ colourName: name, handle, url, created: false, published });
      } else {
        results.push({ colourName: name, handle, url, created: false, published: true });
      }
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
      const created = createJson?.data?.collectionCreate?.collection;
      if (userErrors.length > 0) {
        const msg = userErrors.map((e) => e.message).join("; ");
        console.error(`Collection create error for "${name}":`, userErrors);
        results.push({ colourName: name, handle, url, created: false, published: false, error: msg });
      } else if (created?.id) {
        const published = await publishCollection(admin, shopDomain, created.id);
        results.push({ colourName: name, handle, url, created: true, published });
      } else {
        results.push({ colourName: name, handle, url, created: false, published: false });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`Collection create exception for "${name}":`, error);
      results.push({ colourName: name, handle, url, created: false, published: false, error: msg });
    }
  }

  return results;
}
