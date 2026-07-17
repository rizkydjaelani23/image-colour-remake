import type { LoaderFunctionArgs } from "react-router";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import prisma from "../utils/db.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { r2Client, R2_BUCKET } from "../utils/r2.server";

// ── R2 image proxy ────────────────────────────────────────────────────────────
// Fetches an R2 object server-side and returns it to the browser.
// Triggered by ?r2key=<encoded-object-key> — used by gallery.js to proxy
// preview images through the app so they load reliably on all mobile browsers,
// bypassing any CSP/public-access/WebP-decoder issues with direct R2 URLs.
//
// Security: key must match the expected preview path pattern.
const VALID_R2_KEY = /^[a-z0-9.-]+\.myshopify\.com\/products\/\d+\/zones\/[a-z0-9]+\/[a-z0-9_-]+\.webp$/;

async function handleImageProxy(r2key: string): Promise<Response> {
  if (!r2key || !VALID_R2_KEY.test(r2key)) {
    return new Response("Invalid key", { status: 400 });
  }
  try {
    const obj = await r2Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2key })
    );
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) return new Response("Not found", { status: 404 });

    // Copy into a fresh ArrayBuffer-backed view so the type is a valid BodyInit.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type":                obj.ContentType ?? "image/webp",
        "Cache-Control":               "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
        "Content-Length":              String(bytes.byteLength),
      },
    });
  } catch (err: unknown) {
    const code = (err as { Code?: string })?.Code;
    if (code === "NoSuchKey") return new Response("Not found", { status: 404 });
    console.error("R2 image proxy error:", err);
    return new Response("Server error", { status: 500 });
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);

    // ── Image proxy shortcut ─────────────────────────────────────────────────
    const r2key = url.searchParams.get("r2key");
    if (r2key !== null) return handleImageProxy(r2key);

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
        // Pull in the shop's SEO add-on status so we can tell gallery.js
        // whether to render full "{Product} in {Colour}" alt text.
        shop: { select: { seoAddonActive: true, shopDomain: true } },
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
      return new Response(JSON.stringify({ success: true, product: null, previews: [], seoEnabled: false }), {
        status: 200,
        headers: cacheHeaders,
      });
    }

    // Check SEO add-on for this shop — tells gallery.js whether to use
    // "{Product} in {Colour}" alt text or just the bare colour name.
    const seoEnabled = isSeoAddonActive({
      seoAddonActive: product.shop.seoAddonActive,
      shopDomain:     product.shop.shopDomain,
    });

    if (!product.showOnStorefront) {
      return new Response(
        JSON.stringify({
          success:  true,
          seoEnabled,
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
        seoEnabled,
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
