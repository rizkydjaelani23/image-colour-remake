/**
 * HD render token accounting.
 *
 * 1 token = 1 FLUX HD render (~$0.04 fal.ai cost).
 *
 * Two buckets per shop (stored on ShopUsage):
 *   • Monthly grant  — hdTokenLimit (set by plan), consumed via hdTokensUsed.
 *                      Both reset each billing cycle.
 *   • Top-up packs   — hdTokensExtra. Persists across cycles, consumed only
 *                      after the monthly grant is exhausted.
 *
 * available = max(0, hdTokenLimit − hdTokensUsed) + hdTokensExtra
 */

import prisma from "./db.server";

export interface HdTokenStatus {
  used:      number; // monthly used this cycle
  limit:     number; // monthly included
  extra:     number; // purchased top-up balance
  available: number; // total renders left right now
}

/** Read current HD token status for a shop (no mutation). */
export async function getHdTokenStatus(shopId: string): Promise<HdTokenStatus> {
  const usage = await prisma.shopUsage.findUnique({ where: { shopId } });
  const used  = usage?.hdTokensUsed  ?? 0;
  const limit = usage?.hdTokenLimit  ?? 0;
  const extra = usage?.hdTokensExtra ?? 0;
  const available = Math.max(0, limit - used) + extra;
  return { used, limit, extra, available };
}

/**
 * Atomically consume one HD token. Returns true if a token was available and
 * consumed, false if the shop is out of tokens (caller must then block).
 *
 * Spends the monthly grant first, then the purchased top-up balance.
 */
export async function consumeHdToken(shopId: string): Promise<boolean> {
  // Conditional update inside a transaction to avoid double-spend under concurrency.
  return prisma.$transaction(async (tx) => {
    const usage = await tx.shopUsage.findUnique({ where: { shopId } });
    if (!usage) return false;

    const monthlyLeft = Math.max(0, usage.hdTokenLimit - usage.hdTokensUsed);

    if (monthlyLeft > 0) {
      await tx.shopUsage.update({
        where: { shopId },
        data:  { hdTokensUsed: { increment: 1 } },
      });
      return true;
    }

    if (usage.hdTokensExtra > 0) {
      await tx.shopUsage.update({
        where: { shopId },
        data:  { hdTokensExtra: { decrement: 1 } },
      });
      return true;
    }

    return false; // out of tokens
  });
}

/** Refund one token (e.g. the HD render failed after we consumed it). */
export async function refundHdToken(shopId: string): Promise<void> {
  const usage = await prisma.shopUsage.findUnique({ where: { shopId } });
  if (!usage) return;
  // Prefer to restore the monthly grant; if it wasn't from monthly, restore extra.
  if (usage.hdTokensUsed > 0) {
    await prisma.shopUsage.update({
      where: { shopId },
      data:  { hdTokensUsed: { decrement: 1 } },
    });
  } else {
    await prisma.shopUsage.update({
      where: { shopId },
      data:  { hdTokensExtra: { increment: 1 } },
    });
  }
}

/** Add purchased top-up tokens (called after a Shopify one-time charge clears). */
export async function addHdTokens(shopId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await prisma.shopUsage.update({
    where: { shopId },
    data:  { hdTokensExtra: { increment: amount } },
  });
}
