/**
 * POST /api/rename-fabric-colour
 *
 * Renames a fabric colour shop-wide — used by the Fabric Index table on the
 * SEO dashboard when a colour ended up with a bad display name (most
 * commonly one inherited from an uploaded image's file name).
 *
 * Body: { oldName: string, newName: string }
 *
 * Updates every Preview row showing oldName, re-syncs every affected
 * product's tags/metafield/collection under the new name, and removes the
 * now-empty old collection page. See utils/seo-rename.server.ts.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../utils/shop.server";
import { renameFabricColour } from "../utils/seo-rename.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);

    const { oldName, newName } = await request.json() as { oldName?: unknown; newName?: unknown };

    if (typeof oldName !== "string" || !oldName.trim()) {
      return Response.json({ error: "Missing oldName" }, { status: 400 });
    }
    if (typeof newName !== "string" || !newName.trim()) {
      return Response.json({ error: "Missing newName" }, { status: 400 });
    }

    const result = await renameFabricColour(admin, shop, oldName.trim(), newName.trim());

    if (result.renamedPreviews === 0) {
      return Response.json(
        { error: `No colour named "${oldName.trim()}" was found for this shop.` },
        { status: 404 },
      );
    }

    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("api.rename-fabric-colour error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error renaming colour" },
      { status: 500 },
    );
  }
}
