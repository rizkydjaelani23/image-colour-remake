/**
 * POST /api/regenerate-catalogue
 *
 * Re-renders every existing preview in the shop with the current (V2) engine.
 *
 * For each preview:
 *   1. (optional) Backs up the current image to a stable backup path, so the
 *      merchant can restore the previous look. Only the ORIGINAL is kept — if a
 *      backup already exists it is not overwritten by a re-run.
 *   2. Enqueues a GenerationJob (reusing the normal queue + worker), which
 *      overwrites the preview in place. Regenerations don't consume billing quota.
 *
 * Body (JSON): { keepBackups?: boolean }  — defaults to true.
 * Returns: { queued, skipped, backedUp, total }
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { uploadBufferToStorage } from "../utils/storage.server";
import { enqueueShop } from "../utils/generation-worker.server";
import { R2_PUBLIC_BASE } from "../utils/r2.server";

export function backupPath(shopDomain: string, previewId: string): string {
  return `${shopDomain}/preview-backups/${previewId}.webp`;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await getOrCreateShop(shopDomain);

    const body = await request.json().catch(() => ({}));
    const keepBackups = body?.keepBackups !== false; // default true

    const previews = await prisma.preview.findMany({
      where: { shopId: shop.id },
      include: { swatch: true, zone: true },
    });

    let queued = 0, skipped = 0, backedUp = 0;

    for (const p of previews) {
      const swatchUrl = p.swatch?.imageUrl;
      // Can only regenerate if we still have the swatch image and a zone mask.
      if (!swatchUrl || !p.zone?.maskPath) { skipped++; continue; }

      // ── Back up the current (original) image, once ──────────────────────────
      if (keepBackups && p.imageUrl) {
        const bpath = backupPath(shopDomain, p.id);
        const backupUrl = `${R2_PUBLIC_BASE}/${bpath}`;
        const alreadyBackedUp = await fetch(backupUrl, { method: "HEAD" })
          .then((r) => r.ok).catch(() => false);
        if (!alreadyBackedUp) {
          try {
            const cur = await fetch(p.imageUrl);
            if (cur.ok) {
              await uploadBufferToStorage({
                path: bpath,
                buffer: Buffer.from(await cur.arrayBuffer()),
                contentType: "image/webp",
                upsert: true,
              });
              backedUp++;
            }
          } catch (e) {
            console.warn(`[regenerate-catalogue] backup failed for preview ${p.id}:`, e);
          }
        }
      }

      // ── Enqueue regeneration (replace any pending duplicate) ────────────────
      const existing = await prisma.generationJob.findFirst({
        where: {
          shopId: shop.id, productId: p.productId, zoneId: p.zoneId,
          fabricFamily: p.fabricFamily, colourName: p.colourName, status: "PENDING",
        },
      });
      if (existing) {
        await prisma.generationJob.update({
          where: { id: existing.id },
          data: { swatchUrl, swatchId: p.swatchId, updatedAt: new Date() },
        });
      } else {
        await prisma.generationJob.create({
          data: {
            shopId: shop.id, productId: p.productId, zoneId: p.zoneId,
            shopifyProductId: p.shopifyProductId, fabricFamily: p.fabricFamily,
            colourName: p.colourName, swatchUrl, swatchId: p.swatchId,
            status: "PENDING", progress: 0,
          },
        });
      }
      queued++;
    }

    if (queued > 0) await enqueueShop(shop.id);

    return Response.json({ success: true, queued, skipped, backedUp, total: previews.length });
  } catch (err) {
    console.error("api.regenerate-catalogue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
