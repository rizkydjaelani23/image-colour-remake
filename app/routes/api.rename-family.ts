/**
 * POST /api/rename-family
 *
 * Renames a fabric family across the shop — every swatch, preview and queued
 * job that uses `fromFamily` becomes `toFamily`. Matches case-insensitively.
 *
 * Safe: if renaming would collide with an existing family on the unique key
 * (same colour already exists under the target family for a swatch, or for a
 * product+zone preview), it aborts and reports the clashes instead of failing
 * halfway. Existing images are untouched (their URLs are stored, not derived
 * from the family name), and the storefront re-groups automatically.
 *
 * Body (JSON): { fromFamily, toFamily }
 * Returns: { swatches, previews, jobs } on success, or { error, conflicts } (409).
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    const body = await request.json().catch(() => ({}));
    const fromFamily = (body?.fromFamily ?? "").trim();
    const toFamily   = (body?.toFamily ?? "").trim();

    if (!fromFamily) return Response.json({ error: "Missing current family name" }, { status: 400 });
    if (!toFamily)   return Response.json({ error: "Enter a new family name" }, { status: 400 });
    if (fromFamily.toLowerCase() === toFamily.toLowerCase() && fromFamily === toFamily) {
      return Response.json({ error: "The new name is the same as the current one" }, { status: 400 });
    }

    // ── Conflict check ──────────────────────────────────────────────────────
    const fromSwatches = await prisma.swatch.findMany({
      where: { shopId: shop.id, fabricFamily: ci(fromFamily) },
      select: { colourName: true },
    });
    const toSwatchColours = new Set(
      (await prisma.swatch.findMany({ where: { shopId: shop.id, fabricFamily: ci(toFamily) }, select: { colourName: true } }))
        .map((s) => s.colourName.toLowerCase()),
    );
    const swatchConflicts = fromSwatches
      .filter((s) => toSwatchColours.has(s.colourName.toLowerCase()))
      .map((s) => s.colourName);

    const fromPreviews = await prisma.preview.findMany({
      where: { shopId: shop.id, fabricFamily: ci(fromFamily) },
      select: { productId: true, zoneId: true, colourName: true },
    });
    const toPreviewKeys = new Set(
      (await prisma.preview.findMany({ where: { shopId: shop.id, fabricFamily: ci(toFamily) }, select: { productId: true, zoneId: true, colourName: true } }))
        .map((r) => `${r.productId}|${r.zoneId}|${r.colourName.toLowerCase()}`),
    );
    const previewConflictCount = fromPreviews
      .filter((r) => toPreviewKeys.has(`${r.productId}|${r.zoneId}|${r.colourName.toLowerCase()}`))
      .length;

    if (swatchConflicts.length || previewConflictCount) {
      return Response.json({
        error: `"${toFamily}" already has some of the same colours, so renaming would create duplicates. Resolve these first.`,
        conflicts: { swatches: [...new Set(swatchConflicts)], previews: previewConflictCount },
      }, { status: 409 });
    }

    // ── Rename ──────────────────────────────────────────────────────────────
    const [s, pv, j] = await prisma.$transaction([
      prisma.swatch.updateMany({ where: { shopId: shop.id, fabricFamily: ci(fromFamily) }, data: { fabricFamily: toFamily } }),
      prisma.preview.updateMany({ where: { shopId: shop.id, fabricFamily: ci(fromFamily) }, data: { fabricFamily: toFamily } }),
      prisma.generationJob.updateMany({ where: { shopId: shop.id, fabricFamily: ci(fromFamily) }, data: { fabricFamily: toFamily } }),
    ]);

    return Response.json({ success: true, toFamily, swatches: s.count, previews: pv.count, jobs: j.count });
  } catch (err) {
    console.error("api.rename-family error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
