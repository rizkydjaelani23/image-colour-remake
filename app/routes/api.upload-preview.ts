import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { uploadBufferToStorage } from "../utils/storage.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { updateFabricColoursMetafield } from "../utils/seo-metafield.server";

/**
 * POST /api/upload-preview
 * Accepts a real photo uploaded by the merchant and creates a Preview record.
 * multipart/form-data fields:
 *   imageFile         – the image file (required)
 *   shopifyProductId  – Shopify product GID (required)
 *   colourName        – internal colour name (required)
 *   fabricFamily      – fabric category (required)
 *   customerDisplayName – optional storefront name
 */
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const formData = await request.formData();
  const imageFile = formData.get("imageFile");
  const shopifyProductId = formData.get("shopifyProductId");
  const colourName = (formData.get("colourName") as string | null)?.trim();
  const fabricFamily = (formData.get("fabricFamily") as string | null)?.trim();
  const customerDisplayName = (formData.get("customerDisplayName") as string | null)?.trim() || null;

  if (!(imageFile instanceof File) || imageFile.size === 0)
    return Response.json({ error: "Image file is required" }, { status: 400 });
  if (!shopifyProductId || typeof shopifyProductId !== "string")
    return Response.json({ error: "Missing shopifyProductId" }, { status: 400 });
  if (!colourName)
    return Response.json({ error: "Colour name is required" }, { status: 400 });
  if (!fabricFamily)
    return Response.json({ error: "Fabric family / category is required" }, { status: 400 });

  // Check file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(imageFile.type))
    return Response.json({ error: "Only JPG, PNG, WebP, or GIF images are accepted" }, { status: 400 });

  // Find or create the product record
  const product = await prisma.product.upsert({
    where: { shopId_shopifyProductId: { shopId: shop.id, shopifyProductId } },
    create: { shopId: shop.id, shopifyProductId },
    update: {},
  });

  // Upsert a special "Manual Upload" zone for this product
  // This is a placeholder zone used only for manually uploaded previews
  const zone = await prisma.zone.upsert({
    where: { productId_key: { productId: product.id, key: "manual-upload" } },
    create: {
      shopId: shop.id,
      productId: product.id,
      name: "Manual Upload",
      key: "manual-upload",
    },
    update: {},
  });

  // Upload image to Supabase Storage
  const ext = imageFile.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = `${Date.now()}-${colourName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
  const storagePath = `manual-uploads/${shop.shopDomain}/${product.id}/${safeName}.${ext}`;

  const arrayBuffer = await imageFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { publicUrl } = await uploadBufferToStorage({
    path: storagePath,
    buffer,
    contentType: imageFile.type,
    upsert: true,
  });

  // Create the Preview record
  // Use upsert so re-uploads of same colour/family replace the old one
  const preview = await prisma.preview.upsert({
    where: {
      productId_zoneId_fabricFamily_colourName: {
        productId: product.id,
        zoneId: zone.id,
        fabricFamily,
        colourName,
      },
    },
    create: {
      shopId: shop.id,
      productId: product.id,
      zoneId: zone.id,
      shopifyProductId,
      fabricFamily,
      colourName,
      customerDisplayName,
      imagePath: storagePath,
      imageUrl: publicUrl,
      status: "DRAFT",
      approvedForStorefront: false,
      featured: false,
    },
    update: {
      imagePath: storagePath,
      imageUrl: publicUrl,
      customerDisplayName,
    },
  });

  // ── SEO Engine: update fabric_colours metafield if add-on is active ──
  // Fire-and-forget: errors are caught inside the utility and never throw.
  if (isSeoAddonActive(shop)) {
    void updateFabricColoursMetafield(admin, shopifyProductId, product.id);
  }

  return Response.json({
    success: true,
    preview: {
      id: preview.id,
      shopifyProductId: preview.shopifyProductId,
      fabricFamily: preview.fabricFamily,
      colourName: preview.colourName,
      customerDisplayName: preview.customerDisplayName,
      imageUrl: preview.imageUrl,
      approvedForStorefront: preview.approvedForStorefront,
      featured: preview.featured,
      status: preview.status,
      zoneId: preview.zoneId,
      swatchImageUrl: null,
    },
  });
}
