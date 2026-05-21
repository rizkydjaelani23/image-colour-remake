/**
 * POST /api/fal-webhook
 *
 * Receives completion callbacks from fal.ai when async HD renders finish.
 * This endpoint is called by fal.ai's servers, not by the merchant browser.
 *
 * ── PHASE 1 (current) ───────────────────────────────────────────────────────
 * Feature-flagged OFF. Always returns HTTP 200 so fal.ai does not retry.
 * No side effects. No existing functionality is touched.
 *
 * ── PHASE 2 (upcoming) ──────────────────────────────────────────────────────
 * Will validate fal.ai's webhook signature, parse the payload, download the
 * generated image, upload to R2, update the Preview record, and mark the
 * GenerationJob as DONE.
 *
 * ── WHY ALWAYS 200? ─────────────────────────────────────────────────────────
 * fal.ai retries webhooks on non-2xx responses. Returning 200 even when
 * skipped prevents pointless retry storms if the flag is toggled mid-batch.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { ActionFunctionArgs } from "react-router";
import { isFluxEnabled } from "../utils/generation-flux.server";

export async function action({ request }: ActionFunctionArgs) {
  // Always 200 when feature is off — prevents fal.ai retry loops
  if (!isFluxEnabled()) {
    return Response.json({ ok: true, skipped: true });
  }

  try {
    // ── Phase 2: parse and handle the fal.ai completion payload ───────────
    // const payload = await request.json();
    // const { request_id, status, payload: output } = payload;
    // ... look up GenerationJob by falRequestId, download image, upload R2 ...

    // For now, log the raw payload for debugging when feature is enabled
    // but implementation isn't wired yet.
    let rawBody = "(unreadable)";
    try {
      rawBody = await request.text();
    } catch {
      // ignore
    }
    console.log("[fal-webhook] received payload (Phase 2 not yet wired):", rawBody.slice(0, 300));

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[fal-webhook] error:", err);
    // Still 200 — don't trigger fal.ai retries on our own parse errors
    return Response.json({ ok: true, error: String(err) });
  }
}
