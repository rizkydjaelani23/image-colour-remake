/**
 * POST /api/bulk-hd-render
 *
 * Queues HD FLUX renders for a list of existing previews.
 *
 * ── PHASE 1 (current) ───────────────────────────────────────────────────────
 * Feature-flagged OFF. Returns 503 until FLUX_HD_ENABLED=true is set.
 * No side effects. No existing functionality is touched.
 *
 * ── PHASE 2 (upcoming) ──────────────────────────────────────────────────────
 * Will accept: { previewIds: string[] }
 * Will create GenerationJob records with renderMode="flux-hd" and kick off
 * the HD worker. Returns immediately with job IDs for client-side polling.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { isFluxEnabled } from "../utils/generation-flux.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Always authenticate first — this route is merchant-only
    await authenticate.admin(request);

    if (!isFluxEnabled()) {
      return Response.json(
        {
          error:   "HD rendering is not yet available.",
          detail:  "Set FLUX_HD_ENABLED=true and FAL_KEY in env vars to enable.",
          phase:   1,
        },
        { status: 503 },
      );
    }

    // ── Phase 2 implementation goes here ──────────────────────────────────
    // const body = await request.json();
    // const { previewIds } = body as { previewIds: string[] };
    // ... validate, create jobs, kick off worker ...

    return Response.json(
      { error: "HD rendering coming soon." },
      { status: 503 },
    );
  } catch (err) {
    console.error("[api.bulk-hd-render] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
