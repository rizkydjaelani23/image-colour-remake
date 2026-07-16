/**
 * Per-shop background generation worker.
 *
 * Design:
 *  - One async loop per shop, stored in `activeWorkers` map.
 *  - Different shops never block each other.
 *  - Jobs within a shop run CONCURRENTLY (up to CONCURRENCY at a time).
 *  - Base image + processed mask are fetched ONCE per product:zone and
 *    reused across all colour jobs for that zone — huge speedup for bulk runs.
 *  - On server startup, stuck PROCESSING jobs are reset to PENDING and
 *    workers are restarted for any shops with pending work.
 *  - No Redis, no external queue — just the DB and Node.js async tasks.
 */

import prisma from "./db.server";
import { runGeneration, prefetchZoneBuffers } from "./generation-core.server";
import type { ZoneBuffers } from "./generation-core.server";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** How many jobs to process concurrently per shop.
 *  4 gives good throughput. The blocking JS pixel loops now yield via setImmediate
 *  every 100k pixels, so the event loop stays responsive for mask edits / zone saves
 *  even with 4 concurrent jobs. */
const CONCURRENCY = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state (persists across requests in the same Node.js process)
// ─────────────────────────────────────────────────────────────────────────────

/** shopId → true means a worker loop is running for that shop */
const activeWorkers = new Map<string, boolean>();

/** Runs once per process lifetime */
let initialized = false;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called by api.queue-generation whenever a new job is created.
 * Idempotent — safe to call even if the worker is already running.
 */
export async function enqueueShop(shopId: string): Promise<void> {
  await initOnce();
  kickOffWorker(shopId);
}

/**
 * Call this from any server loader that runs on page load (e.g. the visualiser
 * loader) so that after a Railway restart, stuck PENDING jobs are picked back
 * up automatically without needing a new job to be queued first.
 *
 * Idempotent — after the first call in a process lifetime this returns in <1ms.
 */
export async function ensureWorkersRunning(): Promise<void> {
  await initOnce();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────────────────

async function initOnce(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    // Reset any jobs that were mid-flight when the server was last killed
    const stuck = await prisma.generationJob.updateMany({
      where: { status: "PROCESSING" },
      data: { status: "PENDING", progress: 0, startedAt: null },
    });
    if (stuck.count > 0) {
      console.log(`[worker] Reset ${stuck.count} stuck PROCESSING job(s) to PENDING`);
    }

    // Re-start workers for shops that still have work to do
    const pendingShops = await prisma.generationJob.findMany({
      where: { status: "PENDING" },
      distinct: ["shopId"],
      select: { shopId: true },
    });
    for (const { shopId } of pendingShops) {
      kickOffWorker(shopId);
    }
  } catch (err) {
    console.error("[worker] init error:", err);
  }
}

function kickOffWorker(shopId: string): void {
  if (activeWorkers.get(shopId)) return; // already running
  activeWorkers.set(shopId, true);

  // Fire-and-forget — errors are caught inside the loop
  runWorkerLoop(shopId).finally(() => {
    activeWorkers.delete(shopId);
  });
}

async function runWorkerLoop(shopId: string): Promise<void> {
  // Cache shared buffers (base image + processed mask) per product:zone.
  // Lives for the duration of this worker loop run — avoids re-downloading
  // the same large image and re-processing the same mask for every colour
  // in a bulk run.
  const bufferCache = new Map<string, ZoneBuffers>();

  while (true) {
    // Grab up to CONCURRENCY pending jobs at once (oldest first)
    const jobs = await prisma.generationJob.findMany({
      where: { shopId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: CONCURRENCY,
    });

    if (jobs.length === 0) break; // no more work — exit, worker will be GC'd

    // Claim all grabbed jobs atomically before doing any work
    await prisma.generationJob.updateMany({
      where: { id: { in: jobs.map((j) => j.id) }, status: "PENDING" },
      data: { status: "PROCESSING", startedAt: new Date(), progress: 5 },
    });

    // Identify unique product:zone combos in this batch that aren't cached yet
    const missingKeys = new Set<string>();
    for (const job of jobs) {
      const key = `${job.productId}:${job.zoneId}`;
      if (!bufferCache.has(key)) missingKeys.add(key);
    }

    // Pre-fetch shared buffers in parallel (base image + processed mask, once per zone)
    if (missingKeys.size > 0) {
      await Promise.all(
        Array.from(missingKeys).map(async (key) => {
          const [productId, zoneId] = key.split(":");
          const buffers = await prefetchZoneBuffers(productId, zoneId);
          if (buffers) {
            bufferCache.set(key, buffers);
            console.log(`[worker] cached buffers for ${key} (${buffers.width}×${buffers.height})`);
          }
        }),
      );
    }

    // Process all jobs in this batch concurrently
    console.log(`[worker] shop=${shopId} processing batch of ${jobs.length} job(s) concurrently`);
    await Promise.all(jobs.map((job) => processJob(job, bufferCache)));
  }
}

async function processJob(
  job: { id: string; shopId: string; productId: string; zoneId: string; shopifyProductId: string; fabricFamily: string; colourName: string; swatchUrl: string; swatchId: string | null },
  bufferCache: Map<string, ZoneBuffers>,
): Promise<void> {
  console.log(`[worker] shop=${job.shopId} job=${job.id} → PROCESSING (${job.fabricFamily} / ${job.colourName})`);

  try {
    // Fetch the swatch buffer from its R2 URL
    const swatchResponse = await fetch(job.swatchUrl);
    if (!swatchResponse.ok) {
      throw new Error(`Could not fetch swatch from ${job.swatchUrl}: ${swatchResponse.status}`);
    }
    const swatchBuffer = Buffer.from(await swatchResponse.arrayBuffer());

    // Look up shop domain (needed for storage paths)
    const shop = await prisma.shop.findUnique({
      where: { id: job.shopId },
      select: { shopDomain: true },
    });
    if (!shop) throw new Error(`Shop ${job.shopId} not found`);

    // Pull pre-fetched shared buffers from cache (if available)
    const cacheKey = `${job.productId}:${job.zoneId}`;
    const shared   = bufferCache.get(cacheKey);

    // Does a preview for this exact combo already exist? If so this job is an
    // overwrite / regeneration (e.g. re-rendering with the new engine) and must
    // NOT consume billing quota — only net-new previews count.
    const existingPreview = await prisma.preview.findUnique({
      where: {
        productId_zoneId_fabricFamily_colourName: {
          productId:    job.productId,
          zoneId:       job.zoneId,
          fabricFamily: job.fabricFamily,
          colourName:   job.colourName,
        },
      },
      select: { id: true },
    });
    const isNewPreview = !existingPreview;

    const result = await runGeneration(
      {
        shopId:           job.shopId,
        shopDomain:       shop.shopDomain,
        productId:        job.productId,
        zoneId:           job.zoneId,
        shopifyProductId: job.shopifyProductId,
        fabricFamily:     job.fabricFamily,
        colourName:       job.colourName,
        swatchBuffer,
        swatchId:         job.swatchId,
        // Inject pre-fetched shared buffers — skips base image + mask fetch/processing
        preloadedBaseBuffer:  shared?.baseBuffer,
        preloadedWidth:       shared?.width,
        preloadedHeight:      shared?.height,
        preloadedMaskBuffer:  shared?.maskBuffer,
      },
      async (pct) => {
        // Persist progress to DB so the polling endpoint can reflect it
        await prisma.generationJob.update({
          where: { id: job.id },
          data: { progress: pct },
        });
      },
    );

    // Increment shop usage (DB-only) — ONLY for net-new previews. Overwrites /
    // regenerations reuse an existing preview slot and don't consume quota.
    if (isNewPreview) {
      const usage = await prisma.shopUsage.findUnique({ where: { shopId: job.shopId } });
      if (usage) {
        const limitEnforcement = await prisma.shopUsage.updateMany({
          where: { shopId: job.shopId, previewCount: { lt: usage.previewLimit } },
          data:  { previewCount: { increment: 1 } },
        });
        if (limitEnforcement.count === 0) {
          // Limit was hit — the preview was saved but we won't count it
          console.warn(`[worker] job=${job.id} usage limit reached after generation`);
        }
      }
    }

    // Mark done
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status:      "DONE",
        progress:    100,
        completedAt: new Date(),
        previewId:   result.previewId,
        previewUrl:  result.previewUrl,
      },
    });

    console.log(`[worker] job=${job.id} → DONE  url=${result.previewUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job=${job.id} → FAILED: ${message}`);

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status:       "FAILED",
        errorMessage: message,
        completedAt:  new Date(),
      },
    }).catch(() => {/* ignore secondary DB error */});
  }
}
