/**
 * GET /api/visualiser-products?collectionId=gid://... | ?all=1
 *
 * Loads the product list for the Visualiser picker on demand — scoped to one
 * collection (fast) or the whole catalogue (only when explicitly requested).
 * Keeps the Visualiser page load instant instead of paginating everything.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type Product = {
  id: string;
  title: string;
  status: string;
  image: string | null;
  collections: Array<{ id: string; title: string }>;
};

const NODE = `
  id
  title
  status
  featuredImage { url }
  collections(first: 10) { edges { node { id title } } }
`;

type Node = {
  id: string; title: string; status: string;
  featuredImage: { url: string } | null;
  collections: { edges: Array<{ node: { id: string; title: string } }> };
};

function mapNode(n: Node): Product {
  return {
    id: n.id,
    title: n.title,
    status: n.status,
    image: n.featuredImage?.url ?? null,
    collections: (n.collections?.edges ?? []).map((e) => ({ id: e.node.id, title: e.node.title })),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const collectionId = url.searchParams.get("collectionId");
  const all = url.searchParams.get("all");

  const products: Product[] = [];
  try {
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      let page: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges?: Array<{ node: Node }> } | undefined;

      if (collectionId) {
        const res = await admin.graphql(
          `query ($id: ID!, $cursor: String) {
            collection(id: $id) {
              products(first: 250, after: $cursor, sortKey: TITLE) {
                pageInfo { hasNextPage endCursor }
                edges { node { ${NODE} } }
              }
            }
          }`,
          { variables: { id: collectionId, cursor } },
        );
        const json = await res.json() as { data?: { collection?: { products: typeof page } } };
        page = json.data?.collection?.products;
      } else if (all) {
        const res = await admin.graphql(
          `query ($cursor: String) {
            products(first: 250, after: $cursor, sortKey: TITLE) {
              pageInfo { hasNextPage endCursor }
              edges { node { ${NODE} } }
            }
          }`,
          { variables: { cursor } },
        );
        const json = await res.json() as { data?: { products?: typeof page } };
        page = json.data?.products;
      } else {
        return Response.json({ products: [] });
      }

      if (!page) break;
      for (const e of page.edges ?? []) products.push(mapNode(e.node));
      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor ?? null;
    }
  } catch (e) {
    console.error("api.visualiser-products error:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed to load products", products: [] }, { status: 500 });
  }

  return Response.json({ products });
}
