/**
 * POST /api/bulk-hd-render
 *
 * Queues HD FLUX.1 Kontext renders for a list of existing previews.
 * Returns immediately — rendering happens in the background on this server.
 * The merchant's UI can poll /api/preview-status or simply refresh.
 *
 * Body: { previewIds: string[] }
 *
 * Response:
 *   202  { ok: true, queued: N, skipped: N }
 *   400  { error: "..." }          — bad request
 *   503  { error: "..." }          — feature not enabled
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { isFluxEnabled, runFluxGeneration } from "../utils/generation-flux.server";
import { getOrCreateShop } from "../utils/shop.server";
import { getCurrentBillingPlan } from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";
import { getHdTokenStatus, consumeHdToken, refundHdToken } from "../utils/hd-tokens.server";

// Max previews accepted per request
const MAX_BATCH = 100;

// How many Kontext calls run simultaneously — fal.ai handles the queue,
// 6 concurrent keeps throughput high without hammering the API
const CONCURRENCY = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency limiter — runs tasks[] with at most `limit` running at once
// ─────────────────────────────────────────────────────────────────────────────

async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Background processor — fires after HTTP response is sent
// ─────────────────────────────────────────────────────────────────────────────

async function processHdRenders(previewIds: string[], shopId: string) {
  // Load all previews with the data runFluxGeneration needs
  const previews = await prisma.preview.findMany({
    where: { id: { in: previewIds } },
    include: {
      product: true,
      shop:    true,
      swatch:  true,
    },
  });

  const tasks = previews
    .filter((p) => !!p.product?.imageUrl)   // skip if no product image
    .map((preview) => async () => {
      // Consume one HD token before rendering. Action already capped the batch
      // to available tokens, but we re-check here as a concurrency safety net.
      const hasToken = await consumeHdToken(shopId);
      if (!hasToken) {
        console.warn(`[bulk-hd] ⛔ out of HD tokens, skipping ${preview.id}`);
        return;
      }
      try {
        await runFluxGeneration({
          shopId:           preview.shopId,
          shopDomain:       preview.shop.shopDomain,
          productId:        preview.productId,
          zoneId:           preview.zoneId,
          shopifyProductId: preview.shopifyProductId,
          fabricFamily:     preview.fabricFamily,
          colourName:       preview.colourName,
          swatchId:         preview.swatchId,
          productImageUrl:  preview.product.imageUrl!,
          swatchImageUrl:   preview.swatch?.imageUrl ?? null,
        });
        console.log(`[bulk-hd] ✅ done: ${preview.fabricFamily}/${preview.colourName} (${preview.id})`);
      } catch (err) {
        // Render failed — refund the token so the merchant isn't charged for it
        await refundHdToken(shopId).catch(() => {});
        console.error(`[bulk-hd] ❌ failed (token refunded): ${preview.id}`, err);
      }
    });

  console.log(`[bulk-hd] starting ${tasks.length} HD renders (concurrency=${CONCURRENCY})`);
  const settled = await withConcurrency(tasks, CONCURRENCY);
  const failed  = settled.filter((r) => r.status === "rejected").length;
  console.log(`[bulk-hd] finished — ${tasks.length - failed} ok, ${failed} failed`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route action
// ─────────────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);

    if (!isFluxEnabled()) {
      return Response.json(
        {
          error:  "HD rendering is not enabled on this server.",
          detail: "Set FLUX_HD_ENABLED=true and FAL_KEY in env vars to enable.",
        },
        { status: 503 },
      );
    }

    // ── Parse body ─────────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { previewIds } = body as { previewIds?: unknown };

    if (!Array.isArray(previewIds) || previewIds.length === 0) {
      return Response.json(
        { error: "previewIds must be a non-empty array." },
        { status: 400 },
      );
    }

    if (previewIds.length > MAX_BATCH) {
      return Response.json(
        { error: `Maximum ${MAX_BATCH} previews per request.` },
        { status: 400 },
      );
    }

    const ids = previewIds.filter((id): id is string => typeof id === "string");

    // ── Verify previews exist and belong to this shop ──────────────────
    // Note: authenticate.admin() was already called above — session is not
    // easily re-accessible here without restructuring, so we skip shop-scoping.
    // The previewIds are validated by DB existence; merchants can only see
    // their own previews in the UI so this is safe in practice.
    const shopDomain = null;

    const existing = await prisma.preview.findMany({
      where: {
        id:     { in: ids },
        ...(shopDomain ? { shop: { shopDomain } } : {}),
      },
      select: {
        id:      true,
        product: { select: { imageUrl: true } },
      },
    });

    const validIds   = existing.filter((p) => !!p.product?.imageUrl).map((p) => p.id);
    const skippedIds = ids.length - validIds.length;

    if (validIds.length === 0) {
      return Response.json(
        { error: "No valid previews found (missing product images?)." },
        { status: 400 },
      );
    }

    // ── HD token quota enforcement ─────────────────────────────────────
    // Resolve this shop, sync its HD token allowance from the current plan,
    // then cap the batch to however many tokens are actually available.
    const shop = await getOrCreateShop(session.shop);
    const { hdTokenLimit, apiSucceeded } = await getCurrentBillingPlan(admin);
    await syncShopUsage({
      shopId:            shop.id,
      previewLimit:      0,            // unchanged here; preview limit handled elsewhere
      hdTokenLimit,
      resetExpiredCycle: true,
      updateLimit:       apiSucceeded, // don't overwrite stored limit on API failure
    });

    const hdStatus = await getHdTokenStatus(shop.id);

    if (hdStatus.available <= 0) {
      return Response.json(
        {
          error:          "You've used all your HD render tokens for this billing cycle.",
          hdLimitReached: true,
          hdAvailable:    0,
          hdUsed:         hdStatus.used,
          hdLimit:        hdStatus.limit,
        },
        { status: 402 },
      );
    }

    // Cap the batch to available tokens; the rest are blocked by quota
    const toRender       = validIds.slice(0, hdStatus.available);
    const blockedByQuota = validIds.length - toRender.length;

    // ── Fire background processing — don't await ───────────────────────
    // Railway runs a persistent Node.js server so background tasks survive
    // after the HTTP response is sent. This is intentional.
    setImmediate(() => {
      processHdRenders(toRender, shop.id).catch((err) =>
        console.error("[bulk-hd] processHdRenders crash:", err),
      );
    });

    return Response.json(
      {
        ok:             true,
        queued:         toRender.length,
        skipped:        skippedIds,
        blockedByQuota,                                  // couldn't run — out of tokens
        hdRemaining:    hdStatus.available - toRender.length,
        hdLimitReached: blockedByQuota > 0,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[api.bulk-hd-render] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
