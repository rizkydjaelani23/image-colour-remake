/**
 * POST /api/gsc-refresh-data
 *
 * Fetches fresh Google Search Console data for all fabric collection pages
 * and saves it as cached JSON on the GscConnection record.
 *
 * Cache TTL: 6 hours. If the cache is still fresh, returns cached data immediately.
 * Access token is refreshed automatically if it has expired or is about to expire.
 *
 * Response:
 *   {
 *     ok:        true,
 *     fromCache: boolean,
 *     data:      Record<collectionHandle, { clicks, impressions, position }>
 *   }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { refreshAccessToken, queryGscUrlData } from "../utils/gsc.server";
import { colourToCollectionHandle } from "../utils/colour";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    if (!isSeoAddonActive(shop)) {
      return Response.json({ error: "SEO add-on not active" }, { status: 403 });
    }

    const gsc = await prisma.gscConnection.findUnique({
      where: { shopId: shop.id },
    });

    if (!gsc) {
      return Response.json({ error: "Google Search Console is not connected." }, { status: 404 });
    }

    // ── Return cache if still fresh ───────────────────────────────────────────
    const cacheAge = gsc.cacheUpdatedAt
      ? Date.now() - gsc.cacheUpdatedAt.getTime()
      : Infinity;

    if (cacheAge < CACHE_TTL_MS && gsc.cachedData) {
      return Response.json({
        ok:        true,
        fromCache: true,
        cacheAgeMinutes: Math.round(cacheAge / 60_000),
        data: JSON.parse(gsc.cachedData) as Record<
          string,
          { clicks: number; impressions: number; position: number }
        >,
      });
    }

    // ── Maybe refresh access token (expires in < 60 s) ─────────────────────
    let accessToken = gsc.accessToken;
    if (gsc.expiresAt.getTime() < Date.now() + 60_000) {
      const refreshed = await refreshAccessToken(gsc.refreshToken);
      accessToken     = refreshed.accessToken;
      await prisma.gscConnection.update({
        where: { id: gsc.id },
        data:  { accessToken, expiresAt: refreshed.expiresAt },
      });
    }

    // ── Build list of collection page URLs ────────────────────────────────────
    const previews = await prisma.preview.findMany({
      where: {
        shopId:               shop.id,
        approvedForStorefront: true,
        NOT:                  { status: "HIDDEN" },
      },
      select: { colourName: true, customerDisplayName: true },
    });

    const seen = new Set<string>();
    const colourNames: string[] = [];
    for (const p of previews) {
      const name = p.customerDisplayName || p.colourName;
      if (!seen.has(name)) { seen.add(name); colourNames.push(name); }
    }

    const baseUrl = gsc.siteUrl.startsWith("sc-domain:")
      ? `https://${gsc.siteUrl.replace("sc-domain:", "")}`
      : gsc.siteUrl.replace(/\/$/, "");

    const urlToHandle = new Map<string, string>();
    for (const name of colourNames) {
      const handle = colourToCollectionHandle(name);
      urlToHandle.set(`${baseUrl}/collections/${handle}`, handle);
    }

    // ── Query GSC ─────────────────────────────────────────────────────────────
    const gscMap = await queryGscUrlData(
      accessToken,
      gsc.siteUrl,
      [...urlToHandle.keys()],
    );

    // ── Convert URL-keyed → handle-keyed ─────────────────────────────────────
    const result: Record<string, { clicks: number; impressions: number; position: number }> = {};
    for (const [url, metrics] of gscMap.entries()) {
      const handle = urlToHandle.get(url);
      if (handle) result[handle] = metrics;
    }

    // ── Persist cache ─────────────────────────────────────────────────────────
    await prisma.gscConnection.update({
      where: { id: gsc.id },
      data:  {
        cachedData:     JSON.stringify(result),
        cacheUpdatedAt: new Date(),
      },
    });

    return Response.json({ ok: true, fromCache: false, cacheAgeMinutes: 0, data: result });
  } catch (error) {
    console.error("api.gsc-refresh-data error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
