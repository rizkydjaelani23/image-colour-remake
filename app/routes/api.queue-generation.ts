/**
 * POST /api/queue-generation
 *
 * Accepts the same form data as api.generate-preview, but:
 *  1. Uploads the swatch to R2 immediately (needs a URL, not just a buffer)
 *  2. Creates a GenerationJob record
 *  3. Kicks off the per-shop background worker
 *  4. Returns immediately with { jobId, status: "queued" }
 *
 * The client polls api.job-status?jobId=... to watch progress.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { upsertProduct } from "../utils/products.server";
import { uploadBufferToStorage } from "../utils/storage.server";
import { getCurrentBillingPlan } from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";
import { safeFolderName } from "../utils/visualiser.server";
import { enqueueShop } from "../utils/generation-worker.server";
import { slugify } from "../utils/generation-core.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();

    const shopifyProductId = formData.get("productId") as string | null;
    const zoneId           = formData.get("zoneId")    as string | null;
    const swatchFile       = formData.get("swatch");
    const swatchUrlRaw     = formData.get("swatchUrl") as string | null;
    const fabricFamilyRaw  = formData.get("fabricFamily") as string | null;
    const colourNameRaw    = formData.get("colourName")   as string | null;
    const swatchIdRaw      = formData.get("swatchId")     as string | null;
    const productTitleRaw  = formData.get("productTitle") as string | null;
    const imageUrlRaw      = formData.get("productImageUrl") as string | null;

    if (!shopifyProductId) {
      return Response.json({ error: "Missing productId" }, { status: 400 });
    }
    if (!zoneId) {
      return Response.json({ error: "Missing zoneId" }, { status: 400 });
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

    // ── Auth / billing check (we have the session here) ──────────────────────
    const shop = await getOrCreateShop(shopDomain);

    const { previewLimit } = await getCurrentBillingPlan(admin);
    const usage = await syncShopUsage({
      shopId: shop.id,
      previewLimit,
      resetExpiredCycle: true,
    });

    if (usage.previewCount >= usage.previewLimit) {
      return Response.json(
        { error: "Preview limit reached for this billing cycle." },
        { status: 403 },
      );
    }

    // ── Ensure product + zone exist in DB ────────────────────────────────────
    const product = await upsertProduct({
      shopId: shop.id,
      shopifyProductId,
      title: productTitleRaw ?? null,
      imageUrl: imageUrlRaw ?? null,
    });

    const zone = await prisma.zone.findFirst({
      where: { id: zoneId, shopId: shop.id, productId: product.id },
    });
    if (!zone) {
      return Response.json({ error: "Zone not found" }, { status: 404 });
    }
    if (!zone.maskPath) {
      return Response.json({ error: "Zone has no mask saved" }, { status: 400 });
    }

    // ── Upload swatch to R2 so the worker can fetch it without the session ────
    let rawSwatchBuffer: Buffer;
    if (hasFile) {
      rawSwatchBuffer = Buffer.from(await (swatchFile as File).arrayBuffer());
    } else {
      const res = await fetch(swatchUrl!);
      if (!res.ok) {
        return Response.json({ error: "Could not download swatch from URL" }, { status: 500 });
      }
      rawSwatchBuffer = Buffer.from(await res.arrayBuffer());
    }

    const safeProduct = safeFolderName(shopifyProductId);
    const safeFamily  = slugify(fabricFamily);
    const safeColour  = slugify(colourName);

    const swatchStoragePath = [
      shopDomain,
      "job-swatches",
      safeProduct,
      `${safeFamily}__${safeColour}__${Date.now()}.png`,
    ].join("/");

    const uploadedSwatch = await uploadBufferToStorage({
      path: swatchStoragePath,
      buffer: rawSwatchBuffer,
      contentType: "image/png",
      upsert: true,
    });

    // ── Create (or replace pending) GenerationJob ────────────────────────────
    // If a PENDING job already exists for this exact combo, replace it so we
    // don't pile up duplicate work.
    const existingPending = await prisma.generationJob.findFirst({
      where: {
        shopId:       shop.id,
        productId:    product.id,
        zoneId,
        fabricFamily,
        colourName,
        status:       "PENDING",
      },
    });

    let job;
    if (existingPending) {
      job = await prisma.generationJob.update({
        where: { id: existingPending.id },
        data: { swatchUrl: uploadedSwatch.publicUrl, swatchId, updatedAt: new Date() },
      });
    } else {
      job = await prisma.generationJob.create({
        data: {
          shopId:          shop.id,
          productId:       product.id,
          zoneId,
          shopifyProductId,
          fabricFamily,
          colourName,
          swatchUrl:       uploadedSwatch.publicUrl,
          swatchId,
          status:          "PENDING",
          progress:        0,
        },
      });
    }

    // ── Kick off (or wake up) the per-shop worker ─────────────────────────────
    await enqueueShop(shop.id);

    return Response.json({
      success: true,
      jobId:   job.id,
      status:  "queued",
      queuePosition: await prisma.generationJob.count({
        where: { shopId: shop.id, status: "PENDING", createdAt: { lte: job.createdAt } },
      }),
    });
  } catch (err) {
    console.error("api.queue-generation error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
