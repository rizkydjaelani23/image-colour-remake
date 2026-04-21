import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import prisma from "../utils/db.server";
import { upsertProduct } from "../utils/products.server";
import { getOrCreateShop } from "../utils/shop.server";
import { uploadBufferToStorage } from "../utils/storage.server";
import { safeFolderName } from "../utils/visualiser.server";

async function tileSwatchToSize(
  swatchBuffer: Buffer,
  width: number,
  height: number,
  tileScale = 0.22,
): Promise<Buffer> {
  const targetTileWidth = Math.max(70, Math.round(width * tileScale));

  const scaledSwatch = await sharp(swatchBuffer)
    .resize({
      width: targetTileWidth,
      withoutEnlargement: false,
      fit: "cover",
    })
    .blur(0.45)
    .modulate({
      brightness: 1.04,
      saturation: 1.12,
    })
    .png()
    .toBuffer();

  const meta = await sharp(scaledSwatch).metadata();
  const sw = meta.width || 128;
  const sh = meta.height || 128;

  const tiles: { input: Buffer; left: number; top: number }[] = [];

  async function tileSwatchToSize(
  swatchBuffer: Buffer,
  width: number,
  height: number,
  tileScale = 0.2,
): Promise<Buffer> {
  const targetSize = Math.max(120, Math.round(width * tileScale));

  const base = await sharp(swatchBuffer)
    .resize(targetSize, targetSize, {
      fit: "cover",
    })
    .blur(1.2)
    .modulate({
      brightness: 1.02,
      saturation: 1.05,
    })
    .png()
    .toBuffer();

  // Stretch instead of tile (KEY FIX)
  return sharp(base)
    .resize(width, height, {
      fit: "fill",
    })
    .blur(1.2)
    .png()
    .toBuffer();
}

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();
}

async function createProcessedMask(
  rawMaskBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const baseMask = await sharp(rawMaskBuffer)
    .resize(width, height)
    .greyscale()
    .threshold(140)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = Buffer.from(baseMask.data);
  const cleaned = Buffer.from(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = data[i];

      let whiteNeighbours = 0;

      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const ni = (y + oy) * width + (x + ox);
          if (data[ni] > 127) whiteNeighbours++;
        }
      }

      if (value > 127 && whiteNeighbours <= 1) {
        cleaned[i] = 0;
      }

      if (value <= 127 && whiteNeighbours >= 7) {
        cleaned[i] = 255;
      }
    }
  }

  return sharp(cleaned, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .blur(1)
    .threshold(120)
    .blur(0.8)
    .png()
    .toBuffer();
}

async function extractMaskedLighting(
  baseBuffer: Buffer,
  maskBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const baseGray = await sharp(baseBuffer)
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = await sharp(maskBuffer)
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(width * height);

  for (let i = 0; i < width * height; i++) {
    const m = mask.data[i] / 255;
    out[i] = Math.round(baseGray.data[i] * m);
  }

  return sharp(out, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .normalize()
    .blur(1)
    .png()
    .toBuffer();
}

async function createDetailMap(
  baseBuffer: Buffer,
  maskBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const blurred = await sharp(baseBuffer)
    .resize(width, height)
    .greyscale()
    .blur(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const base = await sharp(baseBuffer)
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = await sharp(maskBuffer)
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(width * height);

  for (let i = 0; i < width * height; i++) {
    const diff = base.data[i] - blurred.data[i];
    const boosted = 128 + diff * 1.8;
    const masked = Math.round(boosted * (mask.data[i] / 255));
    out[i] = Math.max(0, Math.min(255, masked));
  }

  return sharp(out, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png()
    .toBuffer();
}

async function buildRealisticComposite(params: {
  baseBuffer: Buffer;
  swatchBuffer: Buffer;
  maskBuffer: Buffer;
  width: number;
  height: number;
  tileScale: number;
  blendStrength: number;
  fabricFamily: string;
  colourName: string;
}): Promise<Buffer> {
  const {
    baseBuffer,
    swatchBuffer,
    maskBuffer,
    width,
    height,
    tileScale,
    blendStrength,
    fabricFamily,
    colourName,
  } = params;

    const renderMode = getFabricRenderMode(fabricFamily, colourName);

    const tiledSwatch = await tileSwatchToSize(
      swatchBuffer,
      width,
      height,
      tileScale,
    );

  // Base image detail + lighting
  const maskedLighting = await extractMaskedLighting(
    baseBuffer,
    maskBuffer,
    width,
    height,
  );

  const detailMap = await createDetailMap(
    baseBuffer,
    maskBuffer,
    width,
    height,
  );

  const strongDetailMap = await sharp(baseBuffer)
    .resize(width, height)
    .greyscale()
    .normalise()
    .sharpen(1.4, 1.6, 2.2)
    .png()
    .toBuffer();

  // ===== MAIN FABRIC COLOUR LAYER =====
  // This is the important change:
  // - colour-blend mode uses average colour only
  // - soft-texture mode uses very soft distance texture
  // - fallback uses softened tiled swatch
    let mainFabricLayer: Buffer;

    if (renderMode === "smooth-colour") {
      mainFabricLayer = await createSmoothColourLayer(
        swatchBuffer,
        width,
        height,
      );
    } else if (renderMode === "soft-texture") {
      mainFabricLayer = await createDistanceFabricLayer(
        swatchBuffer,
        width,
        height,
      );
    } else {
      mainFabricLayer = await createSmoothColourLayer(
        swatchBuffer,
        width,
        height,
      );
    }

  // Very soft texture hint, but weak enough that pattern lines do not take over
  const softTextureLayer = await createSoftTextureLayer(
    swatchBuffer,
    width,
    height,
  );

  // Build the final fabric layer:
  // - colour comes mostly from mainFabricLayer
  // - lighting comes from original image
  // - detail maps preserve structure
  // - texture is present only lightly
      const softenedTextureForBlend = await sharp(softTextureLayer)
        .blur(2.4)
        .png()
        .toBuffer();

      const textureLight = await sharp(softenedTextureForBlend)
        .linear(renderMode === "smooth-colour" ? 0.05 : 0.15, renderMode === "smooth-colour" ? 122 : 109)
        .png()
        .toBuffer();

      // For soft-texture fabrics: the soft-light blend desaturates colour heavily,
      // so we apply less lighting and then boost saturation back to preserve chroma.
      const colouredFabric = await sharp(mainFabricLayer)
        .composite([
          { input: maskedLighting, blend: "soft-light" },
          { input: textureLight, blend: "soft-light" },
        ])
        .modulate({
          brightness: renderMode === "smooth-colour" ? 0.90 : 0.99,
          saturation: renderMode === "smooth-colour" ? 1.02 : 1.20,
        })
        .gamma(1.01)
        .png()
        .toBuffer();

  // ===== FINAL PIXEL BLEND =====
  // IMPORTANT:
  // We do NOT blend against the original RGB colour anymore.
  // We neutralise the base to grayscale first, so the original colour
  // does not push the final swatch lighter/darker in hue.
  const baseRaw = await sharp(baseBuffer)
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const fabricRaw = await sharp(colouredFabric)
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maskRaw = await sharp(maskBuffer)
    .resize(width, height)
    .greyscale()
    .blur(0.3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;

    const maskValue = maskRaw.data[i] / 255;
    const alphaBase = renderMode === "smooth-colour" ? 0.82 : blendStrength;
    const alpha = Math.max(0, Math.min(1, maskValue * alphaBase));

    const br = baseRaw.data[idx];
    const bg = baseRaw.data[idx + 1];
    const bb = baseRaw.data[idx + 2];

    const fr = fabricRaw.data[idx];
    const fg = fabricRaw.data[idx + 1];
    const fb = fabricRaw.data[idx + 2];

    // Keep original image fully untouched outside mask
    if (maskValue < 0.01) {
      out[idx] = br;
      out[idx + 1] = bg;
      out[idx + 2] = bb;
      out[idx + 3] = 255;
      continue;
    }

    // Neutralise only inside the fabric area
        const lum = Math.round(0.299 * br + 0.587 * bg + 0.114 * bb);
        const neutralMix = renderMode === "smooth-colour" ? 0.0 : 0.65 * maskValue;

    const nr = Math.round(br * (1 - neutralMix) + lum * neutralMix);
    const ng = Math.round(bg * (1 - neutralMix) + lum * neutralMix);
    const nb = Math.round(bb * (1 - neutralMix) + lum * neutralMix);

    const finalLum = 0.299 * fr + 0.587 * fg + 0.114 * fb;
    const isDarkFabric = finalLum < 115;
    const boost =
      renderMode === "smooth-colour"
        ? (isDarkFabric ? 1.02 : 1.0)
        : (isDarkFabric ? 0.96 : 0.99);

    out[idx] = Math.round(nr * (1 - alpha) + fr * alpha);
    out[idx + 1] = Math.round(ng * (1 - alpha) + fg * alpha);
    out[idx + 2] = Math.round(nb * (1 - alpha) + fb * alpha);
    out[idx + 3] = 255;
  }

  return sharp(out, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function createAverageColourLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const avg = await sharp(swatchBuffer)
    .resize(1, 1)
    .removeAlpha()
    .raw()
    .toBuffer();

  const [r, g, b] = avg;

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: r ?? 128,
        g: g ?? 128,
        b: b ?? 128,
      },
    },
  })
    .png()
    .toBuffer();
}

async function createSmoothColourLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(swatchBuffer)
    .resize(width, height, {
      fit: "fill",
    })
    .blur(14)
    .modulate({
      brightness: 0.98,
      saturation: 1.18,
    })
    .png()
    .toBuffer();
}

function getFabricRenderMode(fabricFamily: string, colourName: string) {
  const text = `${fabricFamily} ${colourName}`.toLowerCase();

  if (
    text.includes("plush") ||
    text.includes("velvet") ||
    text.includes("mink")
  ) {
    return "smooth-colour";
  }

  if (text.includes("suede") || text.includes("venice")) {
    return "soft-texture";
  }

  return "soft-texture";
}

function isLightFabricColour(swatchBuffer: Buffer) {
  return sharp(swatchBuffer)
    .resize(1, 1)
    .removeAlpha()
    .raw()
    .toBuffer()
    .then((avg) => {
      const [r, g, b] = avg;
      const luminance =
        0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0);

      const channelSpread =
        Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0);

      // Light neutral and warm-neutral fabrics should both count
      return luminance >= 170 && channelSpread <= 80;
    });
}

async function createSoftTextureLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const tiled = await tileSwatchToSize(swatchBuffer, width, height, 0.18);

  return sharp(tiled)
    .greyscale()
    .normalise()
    .blur(0.8)
    .modulate({
      brightness: 0.99,
      saturation: 0.6,
    })
    .png()
    .toBuffer();
}

async function createDistanceFabricLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const avg = await sharp(swatchBuffer)
    .resize(1, 1)
    .removeAlpha()
    .raw()
    .toBuffer();

  const [r, g, b] = avg;

  const baseColour = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: r ?? 128,
        g: g ?? 128,
        b: b ?? 128,
      },
    },
  })
    .png()
    .toBuffer();

  const stretchedSwatch = await sharp(swatchBuffer)
    .resize(width, height, {
      fit: "fill",
    })
    .blur(6)
    .modulate({
      brightness: 1.01,
      saturation: 1.04,
    })
    .png()
    .toBuffer();

  const softenedVariation = await sharp(stretchedSwatch)
    .greyscale()
    .blur(3)
    .linear(0.08, 0)
    .png()
    .toBuffer();

  return sharp(baseColour)
    .composite([
      {
        input: softenedVariation,
        blend: "soft-light",
      },
    ])
    .modulate({
      brightness: 1.01,
      saturation: 1.03,
    })
    .png()
    .toBuffer();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const formData = await request.formData();

    const productId = formData.get("productId");
    const zoneId = formData.get("zoneId");
    const swatchFile = formData.get("swatch");
    const swatchUrlRaw = formData.get("swatchUrl");

    const fabricFamilyRaw = formData.get("fabricFamily");
    const colourNameRaw = formData.get("colourName");
    const swatchIdRaw = formData.get("swatchId");

    const fabricFamily =
      typeof fabricFamilyRaw === "string" && fabricFamilyRaw.trim()
        ? fabricFamilyRaw.trim()
        : "Uncategorised";

    const colourName =
      typeof colourNameRaw === "string" && colourNameRaw.trim()
        ? colourNameRaw.trim()
        : `Colour-${Date.now()}`;

    const swatchId =
      typeof swatchIdRaw === "string" && swatchIdRaw.trim()
        ? swatchIdRaw.trim()
        : null;

    const swatchUrl =
      typeof swatchUrlRaw === "string" && swatchUrlRaw.trim()
        ? swatchUrlRaw.trim()
        : null;

    if (!productId || typeof productId !== "string") {
      return Response.json({ error: "Missing product ID" }, { status: 400 });
    }

    const safeProduct = safeFolderName(productId);

    if (!zoneId || typeof zoneId !== "string") {
      return Response.json({ error: "Missing zone ID" }, { status: 400 });
    }

    // Accept EITHER an uploaded file OR a URL to an existing image (e.g. from Shopify Files)
    const hasFile = swatchFile instanceof File && swatchFile.size > 0;

    if (!hasFile && !swatchUrl) {
      return Response.json(
        { error: "Missing swatch. Either upload a file or pick one from Shopify Files." },
        { status: 400 },
      );
    }

    const shop = await getOrCreateShop(shopDomain);

    const now = new Date();

let usage = await prisma.shopUsage.findUnique({
  where: { shopId: shop.id },
});

if (!usage) {
  usage = await prisma.shopUsage.create({
    data: {
      shopId: shop.id,
      previewCount: 0,
      previewLimit: 50,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

if (now > usage.periodEnd) {
  usage = await prisma.shopUsage.update({
    where: { shopId: shop.id },
    data: {
      previewCount: 0,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

//if (usage.previewCount >= usage.previewLimit) {
 // return Response.json(
  //  { error: "Preview limit reached for this billing cycle." },
  //  { status: 403 },
 // );
// }

    const product = await prisma.product.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId: productId,
      },
    });

    if (!product) {
      return Response.json(
        { error: "Product not found in database. Save a zone first." },
        { status: 404 },
      );
    }

    const zone = await prisma.zone.findFirst({
      where: {
        id: zoneId,
        shopId: shop.id,
        productId: product.id,
      },
    });

    if (!zone) {
      return Response.json({ error: "Surface zone not found" }, { status: 404 });
    }

    if (!product.imageUrl) {
      return Response.json(
        { error: "Product base image URL is missing in database." },
        { status: 400 },
      );
    }

    if (!zone.maskPath) {
      return Response.json(
        { error: "Zone mask path is missing in database." },
        { status: 400 },
      );
    }

    const baseResponse = await fetch(product.imageUrl);
    if (!baseResponse.ok) {
      return Response.json(
        { error: "Could not download base image" },
        { status: 500 },
      );
    }

    const baseBuffer = Buffer.from(await baseResponse.arrayBuffer());

    // Load swatch from file upload OR from URL (Shopify Files / recent swatch)
    let swatchBuffer: Buffer;

    if (hasFile) {
      swatchBuffer = Buffer.from(await (swatchFile as File).arrayBuffer());
    } else if (swatchUrl) {
      const swatchResponse = await fetch(swatchUrl);
      if (!swatchResponse.ok) {
        return Response.json(
          { error: "Could not download swatch image from URL" },
          { status: 500 },
        );
      }
      swatchBuffer = Buffer.from(await swatchResponse.arrayBuffer());
    } else {
      return Response.json({ error: "Missing swatch" }, { status: 400 });
    }

    const rawMaskBuffer = await fs.readFile(
    path.join(process.cwd(), "public", zone.maskPath.replace(/^\/+/, "")),
    );

    const baseMeta = await sharp(baseBuffer).metadata();
    const width = baseMeta.width || 1200;
    const height = baseMeta.height || 1200;

    const maskBuffer = await createProcessedMask(rawMaskBuffer, width, height);

    const tileScale = 0.14;
    const blendStrength = 0.75;

    const finalComposite = await buildRealisticComposite({
      baseBuffer,
      swatchBuffer,
      maskBuffer,
      width,
      height,
      tileScale,
      blendStrength,
      fabricFamily,
      colourName,
    });

    const finalWebpBuffer = await sharp(finalComposite)
      .webp({ quality: 90 })
      .toBuffer();

    const safeFamily = slugify(fabricFamily);
    const safeColour = slugify(colourName);

    const storagePath = [
      shop.shopDomain,
      "products",
      safeProduct,
      "zones",
      zone.id,
      `${safeFamily}__${safeColour}.webp`,
    ].join("/");

    const uploaded = await uploadBufferToStorage({
      path: storagePath,
      buffer: finalWebpBuffer,
      contentType: "image/webp",
      upsert: true,
    });

    // Auto-save / update the swatch record so it appears in "Recently used"
    // We always upload a copy of the swatch to our own storage so it survives
    // even if the merchant deletes the original Shopify File.
    let savedSwatchId: string | null = swatchId;

    try {
      const swatchStoragePath = [
        shop.shopDomain,
        "swatches",
        `${safeFamily}__${safeColour}.png`,
      ].join("/");

      const savedSwatchImage = await uploadBufferToStorage({
        path: swatchStoragePath,
        buffer: swatchBuffer,
        contentType: "image/png",
        upsert: true,
      });

      const savedSwatch = await prisma.swatch.upsert({
        where: {
          shopId_fabricFamily_colourName: {
            shopId: shop.id,
            fabricFamily,
            colourName,
          },
        },
        update: {
          imagePath: savedSwatchImage.path,
          imageUrl: savedSwatchImage.publicUrl,
        },
        create: {
          shopId: shop.id,
          fabricFamily,
          colourName,
          imagePath: savedSwatchImage.path,
          imageUrl: savedSwatchImage.publicUrl,
        },
      });

      savedSwatchId = savedSwatch.id;
    } catch (swatchSaveError) {
      // Don't fail the whole request if swatch saving has trouble
      console.error("Failed to auto-save swatch:", swatchSaveError);
    }

    const preview = await prisma.preview.upsert({
      where: {
        productId_zoneId_fabricFamily_colourName: {
          productId: product.id,
          zoneId: zone.id,
          fabricFamily,
          colourName,
        },
      },
      update: {
        swatchId: savedSwatchId,
        imagePath: uploaded.path,
        imageUrl: uploaded.publicUrl,
        width,
        height,
      },
      create: {
        shopId: shop.id,
        productId: product.id,
        zoneId: zone.id,
        swatchId: savedSwatchId,
        shopifyProductId: productId,
        fabricFamily,
        colourName,
        imagePath: uploaded.path,
        imageUrl: uploaded.publicUrl,
        width,
        height,
        status: "DRAFT",
        approvedForStorefront: false,
        featured: false,
      },
    });

    // ✅ ADD THIS BLOCK HERE
    await prisma.shopUsage.update({
      where: { shopId: shop.id },
      data: {
        previewCount: {
          increment: 1,
        },
      },
    });

    return Response.json({
      success: true,
      preview: {
        id: preview.id,
        zoneId,
        url: uploaded.publicUrl,
        imageUrl: uploaded.publicUrl,
        fabricFamily: preview.fabricFamily,
        colourName: preview.colourName,
        approvedForStorefront: preview.approvedForStorefront,
        featured: preview.featured,
        status: preview.status,
      },
    });
  } catch (error) {
    console.error("api.generate-preview error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error generating preview",
      },
      { status: 500 },
    );
  }
}