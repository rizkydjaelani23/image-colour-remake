/**
 * Core image-generation logic shared between:
 *  - app/routes/api.generate-preview.ts  (synchronous, legacy)
 *  - app/utils/generation-worker.server.ts (background queue)
 */

import sharp from "sharp";
import prisma from "./db.server";
import { uploadBufferToStorage } from "./storage.server";
import { safeFolderName } from "./visualiser.server";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerationParams {
  shopId: string;
  shopDomain: string;
  /** DB Product.id */
  productId: string;
  /** DB Zone.id */
  zoneId: string;
  /** Shopify GID – used for storage path and metafield updates */
  shopifyProductId: string;
  fabricFamily: string;
  colourName: string;
  /** Buffer of the raw swatch image */
  swatchBuffer: Buffer;
  /** Existing swatch DB id (if re-generating from a saved swatch) */
  swatchId?: string | null;

  // ── Optional pre-fetched shared buffers (provided by worker cache) ─────────
  // When set, runGeneration skips the network fetches and mask processing for
  // the base image and mask — huge win when many colours share the same zone.
  preloadedBaseBuffer?: Buffer;
  preloadedWidth?: number;
  preloadedHeight?: number;
  preloadedMaskBuffer?: Buffer; // already processed by createProcessedMask
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported helper — lets the worker pre-fetch shared resources once per zone
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneBuffers = {
  baseBuffer: Buffer;
  width: number;
  height: number;
  maskBuffer: Buffer; // already processed
};

/**
 * Fetches and processes the base image + mask for a product/zone pair.
 * The worker calls this once per unique product:zone and caches the result
 * so all colour jobs for that zone share the same buffers.
 */
export async function prefetchZoneBuffers(
  productId: string,
  zoneId: string,
): Promise<ZoneBuffers | null> {
  try {
    const [product, zone] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.zone.findUnique({ where: { id: zoneId } }),
    ]);

    if (!product?.imageUrl || !zone?.maskPath) return null;

    // Fetch base image and raw mask in parallel
    const [baseResponse, rawMaskBuffer] = await Promise.all([
      fetch(product.imageUrl),
      (async () => {
        if (zone.maskPath!.startsWith("http")) {
          const res = await fetch(zone.maskPath!);
          if (!res.ok) throw new Error(`mask fetch failed: ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        }
        const { default: fs }   = await import("node:fs/promises");
        const { default: path } = await import("node:path");
        return fs.readFile(
          path.join(process.cwd(), "public", zone.maskPath!.replace(/^\/+/, "")),
        );
      })(),
    ]);

    if (!baseResponse.ok) return null;
    const baseBuffer = Buffer.from(await baseResponse.arrayBuffer());

    const meta   = await sharp(baseBuffer).metadata();
    const width  = meta.width  || 1200;
    const height = meta.height || 1200;

    const maskBuffer = await createProcessedMask(rawMaskBuffer, width, height);

    return { baseBuffer, width, height, maskBuffer };
  } catch (err) {
    console.error("[generation-core] prefetchZoneBuffers failed:", err);
    return null;
  }
}

export interface GenerationResult {
  previewId: string;
  previewUrl: string;
  imagePath: string;
  fabricFamily: string;
  colourName: string;
  width: number;
  height: number;
  swatchId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tileSwatchToSize(
  swatchBuffer: Buffer,
  width: number,
  height: number,
  tileScale = 0.2,
): Promise<Buffer> {
  const targetSize = Math.max(120, Math.round(width * tileScale));

  const base = await sharp(swatchBuffer)
    .resize(targetSize, targetSize, { fit: "cover" })
    .blur(1.2)
    .modulate({ brightness: 1.02, saturation: 1.05 })
    .png()
    .toBuffer();

  return sharp(base)
    .resize(width, height, { fit: "fill" })
    .blur(1.2)
    .png()
    .toBuffer();
}

async function createProcessedMask(
  rawMaskBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  // All Sharp — runs entirely in libuv worker threads, never blocks Node's event loop.
  // sharp.median(3) is a 3×3 median filter: removes isolated white speckles and
  // fills isolated black holes — equivalent to the old hand-written neighbor loop.
  return sharp(rawMaskBuffer)
    .resize(width, height)
    .greyscale()
    .threshold(140)
    .median(3)      // replaces the blocking JS 8-neighbor cleaning loop
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
  // Sharp's "multiply" blend computes: result = (base × overlay) / 255 per channel.
  // Compositing greyscale-base × greyscale-mask is exactly: out = baseGray × mask / 255
  // — the same as the old JS loop, but running entirely in libuv threads.
  const [greyBase, greyMask] = await Promise.all([
    sharp(baseBuffer)
      .resize(width, height)
      .greyscale()
      .toColourspace("srgb") // promote to 3-ch so composite blend modes work
      .png()
      .toBuffer(),
    sharp(maskBuffer)
      .resize(width, height)
      .greyscale()
      .toColourspace("srgb")
      .png()
      .toBuffer(),
  ]);

  return sharp(greyBase)
    .composite([{ input: greyMask, blend: "multiply" }])
    .greyscale()
    .normalise()
    .blur(1)
    .png()
    .toBuffer();
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if      (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else                 h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function warmBrightnessFactor(h: number, s: number, l: number): number {
  if (s < 0.45 || l < 0.28) return 1.0;
  if (h <= 22 || h >= 338) return 0.91;
  if (h <= 38)             return 0.87;
  if (h <= 52)             return 0.89;
  if (h <= 72)             return 0.91;
  return 1.0;
}

async function getSwatchWarmFactor(swatchBuffer: Buffer): Promise<number> {
  try {
    const { data } = await sharp(swatchBuffer)
      .resize(8, 8, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let rSum = 0, gSum = 0, bSum = 0;
    const px = data.length / 3;
    for (let i = 0; i < data.length; i += 3) {
      rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
    }
    const { h, s, l } = rgbToHsl(rSum / px, gSum / px, bSum / px);
    return warmBrightnessFactor(h, s, l);
  } catch {
    return 1.0;
  }
}

function getFabricRenderMode(fabricFamily: string, colourName: string) {
  const text = `${fabricFamily} ${colourName}`.toLowerCase();
  if (text.includes("plush") || text.includes("velvet") || text.includes("mink")) {
    return "smooth-colour";
  }
  if (text.includes("suede") || text.includes("venice")) {
    return "soft-texture";
  }
  return "soft-texture";
}

async function createSmoothColourLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
  warmFactor = 1.0,
): Promise<Buffer> {
  return sharp(swatchBuffer)
    .resize(width, height, { fit: "fill" })
    .blur(7)
    .modulate({
      brightness: 0.97 * warmFactor,
      saturation: 1.15,
    })
    .png()
    .toBuffer();
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
    .modulate({ brightness: 0.99, saturation: 0.6 })
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
      background: { r: r ?? 128, g: g ?? 128, b: b ?? 128 },
    },
  })
    .png()
    .toBuffer();

  const stretchedSwatch = await sharp(swatchBuffer)
    .resize(width, height, { fit: "fill" })
    .blur(6)
    .modulate({ brightness: 1.01, saturation: 1.04 })
    .png()
    .toBuffer();

  const softenedVariation = await sharp(stretchedSwatch)
    .greyscale()
    .blur(3)
    .linear(0.08, 0)
    .png()
    .toBuffer();

  return sharp(baseColour)
    .composite([{ input: softenedVariation, blend: "soft-light" }])
    .modulate({ brightness: 1.01, saturation: 1.03 })
    .png()
    .toBuffer();
}

export async function buildRealisticComposite(params: {
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
  const { baseBuffer, swatchBuffer, maskBuffer, width, height, blendStrength, fabricFamily, colourName } = params;

  const renderMode = getFabricRenderMode(fabricFamily, colourName);
  const warmFactor = await getSwatchWarmFactor(swatchBuffer);

  const maskedLighting = await extractMaskedLighting(baseBuffer, maskBuffer, width, height);

  let mainFabricLayer: Buffer;
  if (renderMode === "smooth-colour") {
    mainFabricLayer = await createSmoothColourLayer(swatchBuffer, width, height, warmFactor);
  } else if (renderMode === "soft-texture") {
    mainFabricLayer = await createDistanceFabricLayer(swatchBuffer, width, height);
  } else {
    mainFabricLayer = await createSmoothColourLayer(swatchBuffer, width, height);
  }

  const softTextureLayer = await createSoftTextureLayer(swatchBuffer, width, height);

  const softenedTextureForBlend = await sharp(softTextureLayer).blur(2.4).png().toBuffer();
  const textureLight = await sharp(softenedTextureForBlend)
    .linear(renderMode === "smooth-colour" ? 0.10 : 0.15, renderMode === "smooth-colour" ? 118 : 109)
    .png()
    .toBuffer();

  const maskedLightingForBlend = renderMode === "smooth-colour"
    ? await sharp(maskedLighting).linear(0.55, 58).png().toBuffer()
    : maskedLighting;

  const colouredFabric = await sharp(mainFabricLayer)
    .composite([
      { input: maskedLightingForBlend, blend: "soft-light" },
      { input: textureLight, blend: "soft-light" },
    ])
    .modulate({
      brightness: (renderMode === "smooth-colour" ? 0.93 : 0.99) * warmFactor,
      saturation: renderMode === "smooth-colour" ? 1.15 : 1.20,
    })
    .gamma(1.01)
    .png()
    .toBuffer();

  // Fetch all three raw pixel arrays concurrently (all run in libuv threads)
  const [baseRaw, fabricRaw, maskRaw] = await Promise.all([
    sharp(baseBuffer).resize(width, height).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(colouredFabric).resize(width, height).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(maskBuffer).resize(width, height).greyscale().blur(0.3).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const out = Buffer.alloc(width * height * 4);

  // This loop contains per-pixel conditional alpha logic that can't be expressed
  // purely in Sharp, so it must run in JS. We yield the event loop every CHUNK
  // pixels so the server can handle HTTP requests (mask saves, zone loads, etc.)
  // while generation is in progress. A 1200×1200 image = ~1.44M pixels → ~14 yields.
  const CHUNK = 100_000;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const maskValue = maskRaw.data[i] / 255;

    const br = baseRaw.data[idx];
    const bg = baseRaw.data[idx + 1];
    const bb = baseRaw.data[idx + 2];

    let fr = fabricRaw.data[idx];
    let fg = fabricRaw.data[idx + 1];
    let fb = fabricRaw.data[idx + 2];

    if (maskValue < 0.01) {
      out[idx] = br; out[idx + 1] = bg; out[idx + 2] = bb; out[idx + 3] = 255;
      continue;
    }

    const sourceLum    = 0.299 * br + 0.587 * bg + 0.114 * bb;
    const fabricLumRaw = 0.299 * fr + 0.587 * fg + 0.114 * fb;

    const isBlackFabric     = fabricLumRaw < 25;
    const isDarkFabric      = fabricLumRaw >= 25  && fabricLumRaw < 85;
    const isMidLightFabric  = fabricLumRaw >= 130 && fabricLumRaw <= 160;
    const isBrightFabric    = fabricLumRaw > 160  && fabricLumRaw <= 210;
    const isNearWhiteFabric = fabricLumRaw > 210;

    const alphaBase = renderMode === "smooth-colour"
      ? (isBlackFabric     ? 0.82
       : isDarkFabric      ? 0.91
       : isMidLightFabric  ? 0.74
       : isNearWhiteFabric ? 0.73
       : isBrightFabric    ? 0.80
       : 0.88)
      : blendStrength;
    const alpha = Math.max(0, Math.min(1, maskValue * alphaBase));

    const lumCap = renderMode === "smooth-colour" ? 2.50 : 1.14;
    if (fabricLumRaw > 10 && fabricLumRaw > sourceLum * lumCap) {
      const lumScale = (sourceLum * lumCap) / fabricLumRaw;
      fr = Math.min(255, Math.round(fr * lumScale));
      fg = Math.min(255, Math.round(fg * lumScale));
      fb = Math.min(255, Math.round(fb * lumScale));
    }

    const lum = Math.round(0.299 * br + 0.587 * bg + 0.114 * bb);
    const neutralMix = renderMode === "smooth-colour" ? 0.0 : 0.65 * maskValue;

    const nr = Math.round(br * (1 - neutralMix) + lum * neutralMix);
    const ng = Math.round(bg * (1 - neutralMix) + lum * neutralMix);
    const nb = Math.round(bb * (1 - neutralMix) + lum * neutralMix);

    const finalLum = 0.299 * fr + 0.587 * fg + 0.114 * fb;
    const isDarkFabricFinal = finalLum < 115;
    const boost = renderMode === "smooth-colour"
      ? (isDarkFabricFinal ? 1.02 : 1.0)
      : (isDarkFabricFinal ? 0.96 : 0.99);

    out[idx]     = Math.max(0, Math.min(255, Math.round(nr * (1 - alpha) + fr * boost * alpha)));
    out[idx + 1] = Math.max(0, Math.min(255, Math.round(ng * (1 - alpha) + fg * boost * alpha)));
    out[idx + 2] = Math.max(0, Math.min(255, Math.round(nb * (1 - alpha) + fb * boost * alpha)));
    out[idx + 3] = 255;

    // Yield every CHUNK pixels so HTTP requests can be serviced between chunks
    if (i > 0 && i % CHUNK === 0) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main generation function — shared by route and background worker
// ─────────────────────────────────────────────────────────────────────────────

export async function runGeneration(
  params: GenerationParams,
  onProgress?: (pct: number) => Promise<void>,
): Promise<GenerationResult> {
  const {
    shopId,
    shopDomain,
    productId,
    zoneId,
    shopifyProductId,
    fabricFamily,
    colourName,
    swatchBuffer,
  } = params;
  let { swatchId } = params;

  await onProgress?.(10);

  // ── Use pre-fetched buffers from worker cache when available ──────────────
  let baseBuffer: Buffer;
  let width: number;
  let height: number;
  let maskBuffer: Buffer;

  if (
    params.preloadedBaseBuffer &&
    params.preloadedMaskBuffer &&
    params.preloadedWidth &&
    params.preloadedHeight
  ) {
    // Fast path — shared buffers injected by the worker (no network fetches needed)
    baseBuffer  = params.preloadedBaseBuffer;
    maskBuffer  = params.preloadedMaskBuffer;
    width       = params.preloadedWidth;
    height      = params.preloadedHeight;
    await onProgress?.(40); // jump straight to the composite step
  } else {
    // Slow path — fetch everything from scratch (used by the legacy sync route)
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error("Product not found");
    if (!product.imageUrl) throw new Error("Product base image URL is missing");

    const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new Error("Zone not found");
    if (!zone.maskPath) throw new Error("Zone mask path is missing");

    // Fetch base image and raw mask in parallel
    const [baseResponse, rawMaskBuffer] = await Promise.all([
      fetch(product.imageUrl),
      (async () => {
        if (zone.maskPath!.startsWith("http")) {
          const res = await fetch(zone.maskPath!);
          if (!res.ok) throw new Error("Could not download mask image");
          return Buffer.from(await res.arrayBuffer());
        }
        const { default: fs }   = await import("node:fs/promises");
        const { default: path } = await import("node:path");
        return fs.readFile(
          path.join(process.cwd(), "public", zone.maskPath!.replace(/^\/+/, "")),
        );
      })(),
    ]);

    if (!baseResponse.ok) throw new Error("Could not download base image");
    baseBuffer = Buffer.from(await baseResponse.arrayBuffer());

    await onProgress?.(20);

    const baseMeta = await sharp(baseBuffer).metadata();
    width  = baseMeta.width  || 1200;
    height = baseMeta.height || 1200;

    await onProgress?.(30);
    maskBuffer = await createProcessedMask(rawMaskBuffer, width, height);
    await onProgress?.(40);
  }

  const tileScale     = 0.14;
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

  await onProgress?.(75);

  const finalWebpBuffer = await sharp(finalComposite).webp({ quality: 90 }).toBuffer();

  const safeProduct = safeFolderName(shopifyProductId);
  const safeFamily  = slugify(fabricFamily);
  const safeColour  = slugify(colourName);

  const storagePath = [
    shopDomain,
    "products",
    safeProduct,
    "zones",
    zoneId,
    `${safeFamily}__${safeColour}.webp`,
  ].join("/");

  const uploaded = await uploadBufferToStorage({
    path: storagePath,
    buffer: finalWebpBuffer,
    contentType: "image/webp",
    upsert: true,
  });

  await onProgress?.(85);

  // Save / update swatch record
  try {
    const swatchStoragePath = [shopDomain, "swatches", `${safeFamily}__${safeColour}.png`].join("/");
    const savedSwatchImage  = await uploadBufferToStorage({
      path: swatchStoragePath,
      buffer: swatchBuffer,
      contentType: "image/png",
      upsert: true,
    });

    const savedSwatch = await prisma.swatch.upsert({
      where: { shopId_fabricFamily_colourName: { shopId, fabricFamily, colourName } },
      update: { imagePath: savedSwatchImage.path, imageUrl: savedSwatchImage.publicUrl },
      create: {
        shopId,
        fabricFamily,
        colourName,
        imagePath: savedSwatchImage.path,
        imageUrl: savedSwatchImage.publicUrl,
      },
    });
    swatchId = savedSwatch.id;
  } catch (err) {
    console.error("[generation-core] swatch save failed (non-fatal):", err);
  }

  // Upsert preview record
  const preview = await prisma.preview.upsert({
    where: {
      productId_zoneId_fabricFamily_colourName: { productId, zoneId, fabricFamily, colourName },
    },
    update: {
      swatchId: swatchId ?? undefined,
      imagePath: uploaded.path,
      imageUrl: uploaded.publicUrl,
      width,
      height,
    },
    create: {
      shopId,
      productId,
      zoneId,
      swatchId: swatchId ?? undefined,
      shopifyProductId,
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

  await onProgress?.(95);

  return {
    previewId:    preview.id,
    previewUrl:   uploaded.publicUrl,
    imagePath:    uploaded.path,
    fabricFamily: preview.fabricFamily,
    colourName:   preview.colourName,
    width,
    height,
    swatchId:     swatchId ?? null,
  };
}
