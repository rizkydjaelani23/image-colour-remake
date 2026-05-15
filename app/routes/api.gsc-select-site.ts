/**
 * POST /api/gsc-select-site
 *
 * Updates the selected GSC property (siteUrl) for the shop.
 * Clears cached GSC data so the next refresh uses the new site.
 *
 * Body: { siteUrl: string }
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    const body = await request.json() as { siteUrl?: string };
    if (!body.siteUrl) {
      return Response.json({ error: "Missing siteUrl" }, { status: 400 });
    }

    await prisma.gscConnection.update({
      where: { shopId: shop.id },
      data:  {
        siteUrl:        body.siteUrl,
        cachedData:     null, // clear stale cache for old site
        cacheUpdatedAt: null,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
