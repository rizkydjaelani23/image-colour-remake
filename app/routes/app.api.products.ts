import { authenticate } from "../shopify.server";

export async function loader({ request }: { request: Request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query GetProducts {
      products(first: 50) {
        edges {
          node {
            id
            title
            options {
              name
              optionValues {
                name
              }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
          }
        }
      }
    }`,
  );

  const responseJson = await response.json();

  const products =
    responseJson?.data?.products?.edges?.map(({ node }: any) => ({
      id: node.id,
      title: node.title,
      options: node.options || [],
      variants: node.variants?.edges?.map(({ node: variant }: any) => variant) || [],
    })) || [];

  return Response.json({ products });
}