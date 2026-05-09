import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { deleteFileFromStorage } from "../utils/storage.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await getOrCreateShop(shopDomain);

    const formData = await request.formData();
    const swatchId = formData.get("swatchId") as string;

    if (!swatchId) {
      return Response.json({ error: "Missing swatchId" }, { status: 400 });
    }

    const swatch = await prisma.swatch.findFirst({
      where: { id: swatchId, shopId: shop.id },
    });

    if (!swatch) {
      return Response.json({ error: "Swatch not found" }, { status: 404 });
    }

    // Best-effort: remove the file from Supabase storage.
    // Use imagePath (relative storage path) if available.
    if (swatch.imagePath && !swatch.imagePath.startsWith("http")) {
      try {
        await deleteFileFromStorage(swatch.imagePath);
      } catch {
        // Non-critical — continue with DB deletion even if storage cleanup fails
      }
    }

    // Delete the DB record. Previews using this swatch will have swatchId set to
    // null automatically (onDelete: SetNull) — their generated images are unaffected.
    await prisma.swatch.delete({ where: { id: swatchId } });

    return Response.json({ success: true });
  } catch (error) {
    console.error("api.delete-swatch error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error deleting swatch" },
      { status: 500 },
    );
  }
}
