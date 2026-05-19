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

/**
 * Tiles a swatch across a canvas at fine grain scale.
 *
 * tileScale = fraction of the shorter image dimension per tile repeat.
 * 0.05 on a 1200px image → 60px tiles → ~20 repeats across → fine fabric grain.
 *
 * Seams: the overlay is processed without normalise() and with a very low linear
 * coefficient (0.05–0.08), so any tile-boundary variation is imperceptible in the
 * final composite. No two-pass seam hiding needed — that was slower and only
 * necessary when normalise() was amplifying contrast to glaringly visible levels.
 */
async function createTiledTexture(
  swatchBuffer: Buffer,
  width: number,
  height: number,
  tileScale = 0.05,
): Promise<Buffer> {
  const tileSize = Math.max(48, Math.round(Math.min(width, height) * tileScale));

  const tile = await sharp(swatchBuffer)
    .resize(tileSize, tileSize, { fit: "cover" })
    .png()
    .toBuffer();

  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .composite([{ input: tile, tile: true, blend: "over" }])
    .png()
    .toBuffer();
}

/** @deprecated — kept for reference; use createTiledTexture instead */
async function tileSwatchToSize(
  swatchBuffer: Buffer,
  width: number,
  height: number,
  tileScale = 0.2,
): Promise<Buffer> {
  return createTiledTexture(swatchBuffer, width, height, tileScale);
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
    .blur(3)   // increased from 1 — smooths tufting shadows into a gentle gradient
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
      brightness: 0.89 * warmFactor, // was 0.97 — real plush absorbs more light than a flat swatch
      saturation: 1.05,              // was 1.15 — less aggressive boost, avoids oversaturation
    })
    .png()
    .toBuffer();
}

async function createSoftTextureLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  // Tile at 5% scale — fine grain, ~20 repeats across a 1200px image.
  // NO normalise: normalise() was amplifying the swatch photo's internal lighting
  // gradients to the full 0-255 range, making the tile repeat glaringly visible
  // as a rectangular grid on the bed. We want the texture contrast to stay at
  // whatever level the swatch naturally has, then the linear() step in
  // buildRealisticComposite compresses it further to a very subtle overlay.
  const tiled = await createTiledTexture(swatchBuffer, width, height, 0.05);
  return sharp(tiled)
    .greyscale()
    // no normalise — preserves natural (low) swatch contrast, hides tile repeat
    .blur(0.8) // reduced from 1.5 — still smooths tile boundary, saves time
    .modulate({ brightness: 0.99, saturation: 0.6 })
    .png()
    .toBuffer();
}

async function createDistanceFabricLayer(
  swatchBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  // Step 1: accurate flat base colour from 1×1 average of the swatch
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

  // Step 2: properly tiled texture — NOT stretched.
  // Previously: swatch was stretched to full size + blur(6) → huge blotchy patches.
  // Now: tile repeats at 6% scale → fine, realistic surface texture.
  const tiledTexture = await createTiledTexture(swatchBuffer, width, height, 0.06);

  // Step 3: extract greyscale luminance variation from the tiled texture.
  // NO normalise: same reason as createSoftTextureLayer — normalise() blows up
  // any lighting gradient in the swatch photo to full 0-255, making the tile
  // grid blatantly visible. Keep natural swatch contrast and compress with linear().
  const lumVariation = await sharp(tiledTexture)
    .greyscale()
    // no normalise — keeps tile-pattern contrast low
    .blur(1.5)
    .linear(0.08, 0) // was 0.18 — much more subtle; soft-light at these low values
    .png()            // creates a gentle sheen rather than visible patches
    .toBuffer();

  // Step 4: overlay texture as soft-light on the solid base colour
  // soft-light at ~50% grey = neutral, above = lighten, below = darken
  return sharp(baseColour)
    .composite([{ input: lumVariation, blend: "soft-light" }])
    .modulate({ brightness: 0.95, saturation: 1.01 })
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

  // Texture layer: only needed for soft-texture fabrics.
  // For smooth-colour (plush/velvet/mink) the linear coefficient was 0.05 — barely
  // perceptible shimmer — so we skip it entirely and save 3+ Sharp passes per job.
  let textureLight: Buffer | null = null;
  if (renderMode !== "smooth-colour") {
    const softTextureLayer = await createSoftTextureLayer(swatchBuffer, width, height);
    // Reduced blur: 2.0 → 1.0 — still removes tile boundaries, faster
    const softenedTextureForBlend = await sharp(softTextureLayer).blur(1.0).png().toBuffer();
    // Linear maps the texture to a narrow range near neutral soft-light grey (128).
    // 0.08 around 116 → subtle depth for suede/cotton without visible tile pattern.
    textureLight = await sharp(softenedTextureForBlend)
      .linear(0.08, 116)
      .png()
      .toBuffer();
  }

  const maskedLightingForBlend = renderMode === "smooth-colour"
    // Reduced from linear(0.55, 58) — that was mapping lighting to a 140-value range
    // in soft-light, creating strong blotchy patches from tufting shadows/highlights.
    // Now maps to a 50-value range near neutral (128), preserving gentle depth
    // without the uneven patches.
    ? await sharp(maskedLighting).linear(0.20, 108).png().toBuffer()
    : maskedLighting;

  const compositeInputs: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [
    { input: maskedLightingForBlend, blend: "soft-light" },
  ];
  if (textureLight) {
    compositeInputs.push({ input: textureLight, blend: "soft-light" });
  }

  const colouredFabric = await sharp(mainFabricLayer)
    .composite(compositeInputs)
    .modulate({
      brightness: (renderMode === "smooth-colour" ? 0.90 : 0.91) * warmFactor, // was 0.87 — less dark
      saturation: renderMode === "smooth-colour" ? 1.02 : 1.08,                // was 1.05 — slightly less punchy
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
  // while generation is in progress. A 1200×1200 image = ~1.44M pixels → ~144 yields.
  // Smaller chunk = more frequent yields = snappier page navigation during generation.
  const CHUNK = 10_000;

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

    // Alpha controls how much of the fabric layer covers the base image.
    // Lower values let more base shadow/depth show through — making the
    // result look grounded rather than like a flat colour overlay.
    // Reduced ~5-8% from previous values based on real-fabric comparison.
    const alphaBase = renderMode === "smooth-colour"
      ? (isBlackFabric     ? 0.78  // was 0.82
       : isDarkFabric      ? 0.86  // was 0.91
       : isMidLightFabric  ? 0.70  // was 0.74
       : isNearWhiteFabric ? 0.68  // was 0.73
       : isBrightFabric    ? 0.75  // was 0.80
       : 0.83)                      // was 0.88
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
  const blendStrength = 0.70; // was 0.75 — lets more base shadow through for soft-texture fabrics

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
