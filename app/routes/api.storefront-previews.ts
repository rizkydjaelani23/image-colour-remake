import type { LoaderFunctionArgs } from "react-router";
import prisma from "../utils/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");
    const productId  = url.searchParams.get("productId");

    if (!shopDomain) return Response.json({ error: "Missing shop" }, { status: 400 });
    if (!productId)  return Response.json({ error: "Missing productId" }, { status: 400 });

    // ── Single JOIN query instead of 3 sequential round-trips ──────────────
    // Prisma compiles the relation filter into one SQL JOIN.
    const product = await prisma.product.findFirst({
      where: {
        shopifyProductId: productId,
        shop: { shopDomain },
      },
      select: {
        id:                true,
        shopId:            true,
        shopifyProductId:  true,
        title:             true,
        handle:            true,
        imageUrl:          true,
        showOnStorefront:  true,
      },
    });

    // Cache headers:
    // max-age=10        → serve fresh from cache for 10 seconds
    // stale-while-revalidate=50 → after 10s, still serve cached instantly
    //                             BUT refresh in the background simultaneously.
    // Net effect: customers never wait, merchant changes show up within ~10-20s.
    const cacheHeaders = {
      "Cache-Control": "public, max-age=10, stale-while-revalidate=50",
      "Content-Type":  "application/json",
    };

    if (!product) {
      return new Response(JSON.stringify({ success: true, product: null, previews: [] }), {
        status: 200,
        headers: cacheHeaders,
      });
    }

    if (!product.showOnStorefront) {
      return new Response(
        JSON.stringify({
          success:  true,
          product:  {
            id: product.id,
            shopifyProductId: product.shopifyProductId,
            title: product.title,
            handle: product.handle,
            imageUrl: product.imageUrl,
          },
          previews: [],
        }),
        { status: 200, headers: cacheHeaders }
      );
    }

    // ── Previews query (still needs product.id, so unavoidably a second query) ──
    const rawPreviews = await prisma.preview.findMany({
      where: {
        shopId:               product.shopId,
        productId:            product.id,
        approvedForStorefront: true,
        NOT: { status: "HIDDEN" },
      },
      select: {
        id:                  true,
        colourName:          true,
        customerDisplayName: true,
        imageUrl:            true,
        fabricFamily:        true,
        featured:            true,
      },
      orderBy: [
        { featured:     "desc" },
        { fabricFamily: "asc"  },
        { colourName:   "asc"  },
      ],
    });

    // Use customerDisplayName as the colourName if set
    const previews = rawPreviews.map((p) => ({
      id:           p.id,
      colourName:   p.customerDisplayName || p.colourName,
      imageUrl:     p.imageUrl,
      fabricFamily: p.fabricFamily,
      featured:     p.featured,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        product: {
          id: product.id,
          shopifyProductId: product.shopifyProductId,
          title: product.title,
          handle: product.handle,
          imageUrl: product.imageUrl,
        },
        previews,
      }),
      { status: 200, headers: cacheHeaders }
    );

  } catch (error) {
    console.error("api.storefront-previews loader error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error loading storefront previews" },
      { status: 500 }
    );
  }
}
