/**
 * GET /api/gsc-sites
 *
 * Returns the list of Google Search Console properties the connected
 * Google account has access to, plus the currently-selected site URL.
 * Used by the site picker in the SEO dashboard.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { refreshAccessToken, listGscSites } from "../utils/gsc.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    const gsc = await prisma.gscConnection.findUnique({ where: { shopId: shop.id } });
    if (!gsc) return Response.json({ error: "Not connected" }, { status: 404 });

    // Refresh token if expiring
    let accessToken = gsc.accessToken;
    if (gsc.expiresAt.getTime() < Date.now() + 60_000) {
      const refreshed = await refreshAccessToken(gsc.refreshToken);
      accessToken     = refreshed.accessToken;
      await prisma.gscConnection.update({
        where: { id: gsc.id },
        data:  { accessToken, expiresAt: refreshed.expiresAt },
      });
    }

    const sites = await listGscSites(accessToken);
    return Response.json({ ok: true, sites, currentSiteUrl: gsc.siteUrl });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
