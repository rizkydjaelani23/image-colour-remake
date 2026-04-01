import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const PRODUCT_QUERY = `#graphql
  query ProductForVisualiser($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      featuredImage {
        url
      }
      variants(first: 100) {
        nodes {
          id
          title
          image {
            url
          }
        }
      }
    }
  }
`;

type ProductQueryResponse = {
  data?: {
    product?: {
      id: string;
      title: string;
      handle: string;
      featuredImage: { url: string } | null;
      variants: {
        nodes: Array<{
          id: string;
          title: string;
          image: { url: string } | null;
        }>;
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { admin } = await authenticate.admin(request);

    const productId = params.id;

    if (!productId) {
      return Response.json({ error: "Missing product ID" }, { status: 400 });
    }

    const response = await admin.graphql(PRODUCT_QUERY, {
      variables: { id: productId },
    });

    const json = (await response.json()) as ProductQueryResponse;

    console.log("GraphQL response:", JSON.stringify(json, null, 2));

    if (json.errors?.length) {
      return Response.json(
        { error: json.errors[0].message || "GraphQL error" },
        { status: 500 },
      );
    }

    const product = json.data?.product;

    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }

    return Response.json({
      id: product.id,
      title: product.title,
      handle: product.handle,
      featuredImage: product.featuredImage?.url ?? null,
      variants: product.variants.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        image: variant.image?.url ?? null,
      })),
    });
  } catch (error) {
    console.error("api.product.$id.ts error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown server error while loading product",
      },
      { status: 500 },
    );
  }
}