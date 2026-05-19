/**
 * POST /api/generate-preview
 *
 * Synchronous generation — runs the full pipeline in the request and returns
 * when the preview is ready. Uses runGeneration() from generation-core.server.ts
 * so quality, speed optimisations, and rendering logic stay in one place.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { upsertProduct } from "../utils/products.server";
import { getCurrentBillingPlan } from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { updateFabricColoursMetafield } from "../utils/seo-metafield.server";
import { runGeneration } from "../utils/generation-core.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();

    const shopifyProductId = formData.get("productId") as string | null;
    const zoneId           = formData.get("zoneId")    as string | null;
    const swatchFile       = formData.get("swatch");
    const swatchUrlRaw     = formData.get("swatchUrl")       as string | null;
    const fabricFamilyRaw  = formData.get("fabricFamily")    as string | null;
    const colourNameRaw    = formData.get("colourName")      as string | null;
    const swatchIdRaw      = formData.get("swatchId")        as string | null;
    const productTitleRaw  = formData.get("productTitle")    as string | null;
    const imageUrlRaw      = formData.get("productImageUrl") as string | null;

    if (!shopifyProductId) {
      return Response.json({ error: "Missing product ID" }, { status: 400 });
    }
    if (!zoneId) {
      return Response.json({ error: "Missing zone ID" }, { status: 400 });
    }

    const fabricFamily = fabricFamilyRaw?.trim() || "Uncategorised";
    const colourName   = colourNameRaw?.trim()   || `Colour-${Date.now()}`;
    const swatchId     = swatchIdRaw?.trim()     || null;
    const swatchUrl    = swatchUrlRaw?.trim()    || null;
    const hasFile      = swatchFile instanceof File && swatchFile.size > 0;

    if (!hasFile && !swatchUrl) {
      return Response.json(
        { error: "Missing swatch. Upload a file or pick one from saved swatches." },
        { status: 400 },
      );
    }

    // ── Auth / billing check ─────────────────────────────────────────────────
    const shop = await getOrCreateShop(shopDomain);

    const { previewLimit, apiSucceeded } = await getCurrentBillingPlan(admin);
    const usage = await syncShopUsage({
      shopId: shop.id,
      previewLimit,
      resetExpiredCycle: true,
      updateLimit: apiSucceeded,
    });

    if (usage.previewCount >= usage.previewLimit) {
      return Response.json(
        { error: "Preview limit reached for this billing cycle." },
        { status: 403 },
      );
    }

    // ── Ensure product exists in DB ──────────────────────────────────────────
    const product = await upsertProduct({
      shopId: shop.id,
      shopifyProductId,
      title: productTitleRaw ?? null,
      imageUrl: imageUrlRaw ?? null,
    });

    // ── Get swatch buffer ────────────────────────────────────────────────────
    let swatchBuffer: Buffer;
    if (hasFile) {
      swatchBuffer = Buffer.from(await (swatchFile as File).arrayBuffer());
    } else {
      const res = await fetch(swatchUrl!);
      if (!res.ok) {
        return Response.json({ error: "Could not download swatch from URL" }, { status: 500 });
      }
      swatchBuffer = Buffer.from(await res.arrayBuffer());
    }

    // ── Run generation ───────────────────────────────────────────────────────
    // runGeneration handles: base image fetch, mask fetch & processing, composite
    // building, storage upload, swatch save, and preview DB upsert.
    const result = await runGeneration({
      shopId:           shop.id,
      shopDomain,
      productId:        product.id,
      zoneId,
      shopifyProductId,
      fabricFamily,
      colourName,
      swatchBuffer,
      swatchId,
    });

    // ── Increment usage count ────────────────────────────────────────────────
    const limitEnforcement = await prisma.shopUsage.updateMany({
      where: { shopId: shop.id, previewCount: { lt: usage.previewLimit } },
      data:  { previewCount: { increment: 1 } },
    });
    if (limitEnforcement.count === 0) {
      // Limit was hit between the check and now — generation still saved, just not counted
      console.warn(`[generate-preview] usage limit hit post-generation for shop=${shop.id}`);
    }

    // ── SEO metafield update (fire-and-forget) ───────────────────────────────
    if (isSeoAddonActive(shop)) {
      void updateFabricColoursMetafield(admin, shopifyProductId, product.id);
    }

    return Response.json({
      success: true,
      preview: {
        id:                   result.previewId,
        zoneId,
        url:                  result.previewUrl,
        imageUrl:             result.previewUrl,
        fabricFamily:         result.fabricFamily,
        colourName:           result.colourName,
        approvedForStorefront: false,
        featured:             false,
        status:               "DRAFT",
      },
    });
  } catch (error) {
    console.error("api.generate-preview error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error generating preview" },
      { status: 500 },
    );
  }
}
