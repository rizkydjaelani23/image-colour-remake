/**
 * POST /api/restore-previews
 *
 * Restores previews from the backups saved by /api/regenerate-catalogue.
 * For each preview that has a backup, the backup image is written back over the
 * current file (same storage path → same URL), reverting to the pre-regeneration
 * look. Backups are left in place so restore is repeatable.
 *
 * Returns: { restored, missing, total }
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { uploadBufferToStorage } from "../utils/storage.server";
import { R2_PUBLIC_BASE } from "../utils/r2.server";
import { backupPath } from "./api.regenerate-catalogue";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await getOrCreateShop(shopDomain);

    const previews = await prisma.preview.findMany({
      where: { shopId: shop.id },
      select: { id: true, imagePath: true },
    });

    let restored = 0, missing = 0;

    for (const p of previews) {
      const bpath = backupPath(shopDomain, p.id);
      const backupUrl = `${R2_PUBLIC_BASE}/${bpath}`;
      try {
        const res = await fetch(backupUrl);
        if (!res.ok) { missing++; continue; }
        await uploadBufferToStorage({
          path: p.imagePath,
          buffer: Buffer.from(await res.arrayBuffer()),
          contentType: "image/webp",
          upsert: true,
        });
        await prisma.preview.update({
          where: { id: p.id },
          data: { updatedAt: new Date() },
        });
        restored++;
      } catch (e) {
        console.warn(`[restore-previews] restore failed for preview ${p.id}:`, e);
        missing++;
      }
    }

    return Response.json({ success: true, restored, missing, total: previews.length });
  } catch (err) {
    console.error("api.restore-previews error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
