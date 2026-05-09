import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const {
      previewId,
      approvedForStorefront,
      featured,
      status,
      colourName,
      fabricFamily,
      customerDisplayName,
    } = await request.json();

    if (!previewId || typeof previewId !== "string") {
      return Response.json({ error: "Missing previewId" }, { status: 400 });
    }

    const shop = await getOrCreateShop(shopDomain);

    const preview = await prisma.preview.findFirst({
      where: {
        id: previewId,
        shopId: shop.id,
      },
    });

    if (!preview) {
      return Response.json({ error: "Preview not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (typeof approvedForStorefront === "boolean") {
      updateData.approvedForStorefront = approvedForStorefront;
    }

    if (typeof featured === "boolean") {
      updateData.featured = featured;
    }

    if (typeof status === "string") {
      updateData.status = status;
    }

    if (typeof colourName === "string" && colourName.trim()) {
      updateData.colourName = colourName.trim();
    }

    if (typeof fabricFamily === "string" && fabricFamily.trim()) {
      updateData.fabricFamily = fabricFamily.trim();
    }

    if (typeof customerDisplayName === "string") {
      // Empty string clears the override (null = fall back to colourName)
      updateData.customerDisplayName = customerDisplayName.trim() || null;
    }

    const updated = await prisma.preview.update({
      where: {
        id: preview.id,
      },
      data: updateData,
    });

    return Response.json({
      success: true,
      preview: updated,
    });
  } catch (error) {
    console.error("api.preview-update action error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error updating preview",
      },
      { status: 500 },
    );
  }
}