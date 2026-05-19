/**
 * Per-shop background generation worker.
 *
 * Design:
 *  - One async loop per shop, stored in `activeWorkers` map.
 *  - Different shops never block each other.
 *  - Jobs within a shop run sequentially (oldest first).
 *  - On server startup, stuck PROCESSING jobs are reset to PENDING and
 *    workers are restarted for any shops with pending work.
 *  - No Redis, no external queue — just the DB and Node.js async tasks.
 */

import prisma from "./db.server";
import { runGeneration } from "./generation-core.server";

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
  while (true) {
    // Grab the oldest pending job for this shop
    const job = await prisma.generationJob.findFirst({
      where: { shopId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    if (!job) break; // no more work — exit loop, worker will be GC'd

    await processJob(job.id);
  }
}

async function processJob(jobId: string): Promise<void> {
  // Mark as processing
  const job = await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", startedAt: new Date(), progress: 5 },
  });

  console.log(`[worker] shop=${job.shopId} job=${jobId} → PROCESSING (${job.fabricFamily} / ${job.colourName})`);

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

    const result = await runGeneration(
      {
        shopId:          job.shopId,
        shopDomain:      shop.shopDomain,
        productId:       job.productId,
        zoneId:          job.zoneId,
        shopifyProductId: job.shopifyProductId,
        fabricFamily:    job.fabricFamily,
        colourName:      job.colourName,
        swatchBuffer,
        swatchId:        job.swatchId,
      },
      async (pct) => {
        // Persist progress to DB so the polling endpoint can reflect it
        await prisma.generationJob.update({
          where: { id: jobId },
          data: { progress: pct },
        });
      },
    );

    // Increment shop usage (DB-only — no Shopify session needed)
    const usage = await prisma.shopUsage.findUnique({ where: { shopId: job.shopId } });
    if (usage) {
      const limitEnforcement = await prisma.shopUsage.updateMany({
        where: { shopId: job.shopId, previewCount: { lt: usage.previewLimit } },
        data:  { previewCount: { increment: 1 } },
      });
      if (limitEnforcement.count === 0) {
        // Limit was hit — the preview was saved but we won't count it
        console.warn(`[worker] job=${jobId} usage limit reached after generation`);
      }
    }

    // Mark done
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status:      "DONE",
        progress:    100,
        completedAt: new Date(),
        previewId:   result.previewId,
        previewUrl:  result.previewUrl,
      },
    });

    console.log(`[worker] job=${jobId} → DONE  url=${result.previewUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job=${jobId} → FAILED: ${message}`);

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status:       "FAILED",
        errorMessage: message,
        completedAt:  new Date(),
      },
    }).catch(() => {/* ignore secondary DB error */});
  }
}
