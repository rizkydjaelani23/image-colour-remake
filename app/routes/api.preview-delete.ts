import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { previewId } = await request.json();
  if (!previewId) return Response.json({ error: "Missing previewId" }, { status: 400 });

  // Verify the preview belongs to this shop before deleting
  const preview = await prisma.preview.findFirst({
    where: { id: previewId, shopId: shop.id },
    select: { id: true },
  });

  if (!preview) return Response.json({ error: "Preview not found" }, { status: 404 });

  await prisma.preview.delete({ where: { id: previewId } });

  return Response.json({ success: true });
}
