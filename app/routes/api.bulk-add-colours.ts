/**
 * POST /api/bulk-add-colours   (multipart/form-data)
 *
 * Adds one or more new colours to a fabric family across many products at once,
 * using each product's most-recent saved mask. Reuses the normal job queue +
 * worker (V2 engine), so nothing renders one-by-one by hand.
 *
 * Fields:
 *   fabricFamily   string
 *   productIds     JSON string[]  — Shopify product GIDs the merchant selected
 *   colourNames    JSON string[]  — one name per new colour
 *   swatch_0..N    File           — swatch image, index matches colourNames
 *
 * Billing: only NET-NEW previews count against the monthly allowance. If the
 * batch would exceed what's left, we queue up to the limit and report the rest
 * as skipped (never silently dropped).
 *
 * Returns: { queued, skippedNoMask: string[], skippedOverLimit, remaining }
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { uploadBufferToStorage } from "../utils/storage.server";
import { enqueueShop } from "../utils/generation-worker.server";
import { getCurrentBillingPlan } from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";
import { slugify } from "../utils/generation-core.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    const form = await request.formData();
    const fabricFamily = ((form.get("fabricFamily") as string) ?? "").trim();
    let productIds: string[] = [];
    let colourNames: string[] = [];
    try { productIds  = JSON.parse((form.get("productIds")  as string) ?? "[]"); } catch { /* */ }
    try { colourNames = JSON.parse((form.get("colourNames") as string) ?? "[]"); } catch { /* */ }
    colourNames = colourNames.map((c) => (c ?? "").trim()).filter(Boolean);

    if (!fabricFamily) return Response.json({ error: "Choose a fabric family" }, { status: 400 });
    if (colourNames.length === 0) return Response.json({ error: "Add at least one colour" }, { status: 400 });
    if (productIds.length === 0) return Response.json({ error: "Select at least one product" }, { status: 400 });

    // ── Remaining allowance (only net-new previews consume it) ───────────────
    const { previewLimit, apiSucceeded } = await getCurrentBillingPlan(admin);
    const usage = await syncShopUsage({ shopId: shop.id, previewLimit, resetExpiredCycle: true, updateLimit: apiSucceeded });
    const remaining = Math.max(0, usage.previewLimit - usage.previewCount);

    // ── Upload each swatch once; reuse its URL across all products ───────────
    const swatches: Array<{ name: string; url: string }> = [];
    for (let i = 0; i < colourNames.length; i++) {
      const file = form.get(`swatch_${i}`);
      if (!(file instanceof File) || file.size === 0) {
        return Response.json({ error: `Missing swatch image for "${colourNames[i]}"` }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const path = [session.shop, "job-swatches", "bulk", `${slugify(fabricFamily)}__${slugify(colourNames[i])}__${swatches.length}.png`].join("/");
      const uploaded = await uploadBufferToStorage({ path, buffer: buf, contentType: "image/png", upsert: true });
      swatches.push({ name: colourNames[i], url: uploaded.publicUrl });
    }

    // ── Resolve products → most-recent masked zone ───────────────────────────
    const products = await prisma.product.findMany({
      where: { shopId: shop.id, shopifyProductId: { in: productIds } },
      select: {
        id: true, shopifyProductId: true, title: true,
        zones: { where: { maskPath: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1, select: { id: true } },
      },
    });
    const byGid = new Map(products.map((p) => [p.shopifyProductId, p]));

    const skippedNoMask: string[] = [];
    const renderable: Array<{ productId: string; shopifyProductId: string; zoneId: string }> = [];
    for (const gid of productIds) {
      const p = byGid.get(gid);
      if (!p || p.zones.length === 0) { skippedNoMask.push(p?.title || gid.replace("gid://shopify/Product/", "")); continue; }
      renderable.push({ productId: p.id, shopifyProductId: p.shopifyProductId, zoneId: p.zones[0].id });
    }

    // ── Which combos already exist (overwrites don't count toward the limit) ──
    const existing = await prisma.preview.findMany({
      where: {
        shopId: shop.id, fabricFamily,
        productId: { in: renderable.map((r) => r.productId) },
        colourName: { in: colourNames },
      },
      select: { productId: true, zoneId: true, colourName: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.productId}|${e.zoneId}|${e.colourName.toLowerCase()}`));

    // ── Build jobs, capping NET-NEW previews at the remaining allowance ──────
    const jobs: Array<{ productId: string; zoneId: string; shopifyProductId: string; colourName: string; url: string }> = [];
    let netNew = 0;
    let skippedOverLimit = 0;
    for (const r of renderable) {
      for (const sw of swatches) {
        const isNew = !existingKeys.has(`${r.productId}|${r.zoneId}|${sw.name.toLowerCase()}`);
        if (isNew) {
          if (netNew >= remaining) { skippedOverLimit++; continue; }
          netNew++;
        }
        jobs.push({ productId: r.productId, zoneId: r.zoneId, shopifyProductId: r.shopifyProductId, colourName: sw.name, url: sw.url });
      }
    }

    if (jobs.length > 0) {
      await prisma.generationJob.createMany({
        data: jobs.map((j) => ({
          shopId: shop.id, productId: j.productId, zoneId: j.zoneId,
          shopifyProductId: j.shopifyProductId, fabricFamily, colourName: j.colourName,
          swatchUrl: j.url, status: "PENDING" as const, progress: 0,
        })),
      });
      await enqueueShop(shop.id);
    }

    return Response.json({
      success: true,
      queued: jobs.length,
      skippedNoMask,
      skippedOverLimit,
      remaining,
    });
  } catch (err) {
    console.error("api.bulk-add-colours error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
