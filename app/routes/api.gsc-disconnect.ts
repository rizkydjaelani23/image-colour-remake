/**
 * POST /api/gsc-disconnect
 *
 * Removes the Google Search Console connection for the current shop.
 * Does NOT revoke the token at Google's end — the merchant can do that at
 * myaccount.google.com/permissions if needed.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    await prisma.gscConnection.deleteMany({ where: { shopId: shop.id } });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("api.gsc-disconnect error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
