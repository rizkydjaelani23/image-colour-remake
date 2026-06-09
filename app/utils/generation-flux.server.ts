/**
 * FLUX.1 Kontext HD generation — photorealistic fabric colour previews via fal.ai
 *
 * ── APPROACH ────────────────────────────────────────────────────────────────
 * Uses fal-ai/flux-pro/kontext (single-image, instruction-based editing).
 * No mask required — the model edits from the text instruction alone.
 *
 * Pipeline:
 *   1. Extract exact hex colour from the swatch image
 *   2. Upload product image to fal.ai storage
 *   3. Run Kontext with colour+fabric prompt and a fixed seed
 *   4. Download result, upload to R2
 *   5. Upsert Preview record
 *
 * Fixed seed per product ensures all colour variants have identical framing.
 * Output dimensions are determined by the model (~50% of input, aspect preserved).
 * Same input image = same dimensions every time, regardless of colour.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * Completely isolated from the existing Sharp pipeline.
 * Only called when FLUX_HD_ENABLED=true AND FAL_KEY is set.
 * ────────────────────────────────────────────────────────────────────────────
 */

import sharp from "sharp";
import prisma from "./db.server";
import { uploadBufferToStorage } from "./storage.server";
import { slugify } from "./generation-core.server";
import { safeFolderName } from "./visualiser.server";
import type { GenerationResult } from "./generation-core.server";

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag — both must be true
// ─────────────────────────────────────────────────────────────────────────────

export function isFluxEnabled(): boolean {
  return (
    process.env.FLUX_HD_ENABLED === "true" &&
    typeof process.env.FAL_KEY === "string" &&
    process.env.FAL_KEY.trim().length > 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────

// kontext/max follows instructions and renders fabric texture noticeably better
// than the base kontext model — closer to ChatGPT-grade realism.
const FAL_MODEL = "fal-ai/flux-pro/kontext/max" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Lazy fal.ai client
// ─────────────────────────────────────────────────────────────────────────────

async function getFalClient() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("[flux] FAL_KEY is not set.");
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: key });
  return fal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the dominant hex colour from a swatch image buffer.
 * Uses sharp's stats() on a downscaled version for speed.
 */
async function swatchToHex(swatchBuffer: Buffer): Promise<string> {
  const stats = await sharp(swatchBuffer)
    .resize(50, 50, { fit: "cover" })
    .stats();
  const { r, g, b } = stats.dominant;
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabric descriptors
// ─────────────────────────────────────────────────────────────────────────────

// Texture-forward descriptors — these tell the model HOW the fabric catches light,
// so it renders the actual motif (crush marks, sheen, nap) instead of a flat colour.
const FABRIC_DESCRIPTORS: Record<string, string> = {
  plush:    "plush velvet with a soft even sheen and deep light-absorbing pile",
  velvet:   "crushed velvet with an irregular crushed texture that catches the light unevenly, with bright shimmering silvery highlights on the raised crush marks and darker recessed folds throughout the fabric",
  velvetto: "velvetto velvet with a smooth lustrous sheen and gentle light reflection",
  mink:     "mink velvet with an ultra-soft short dense pile and a gentle directional sheen",
  suede:    "microfibre suede with a soft matte nap and subtle directional shading",
  venice:   "Venice fabric with a fine tight woven texture and matte finish",
  boucle:   "bouclé fabric with a looped, nubby, textured woven surface",
  chenille: "chenille with a soft fuzzy ribbed velvety texture",
  naples:   "Naples velvet with a smooth refined sheen and soft pile",
};

function getFabricDescriptor(fabricFamily: string): string {
  const lower = fabricFamily.toLowerCase();
  const match = Object.entries(FABRIC_DESCRIPTORS).find(([k]) => lower.includes(k));
  return match ? match[1] : fabricFamily;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

function buildKontextPrompt(
  fabricFamily: string,
  colourName: string,
  hex: string,
): string {
  const fabric = getFabricDescriptor(fabricFamily);
  return (
    `Reupholster the bed in ${colourName} ${fabric}. ` +
    `The fabric colour must be exactly ${hex}. ` +
    `Render the fabric texture prominently and realistically — show the true surface ` +
    `detail and the way the material catches the light, not a flat colour fill. ` +
    `Keep the bed frame shape, panel stitching, headboard silhouette, divan base, ` +
    `footboard, room background, bedding, pillows, lighting and shadows completely identical. ` +
    `Only the upholstery fabric colour and surface texture changes. ` +
    `High-end photorealistic furniture product photography, sharp fabric detail.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic seed — same product+zone always gets the same framing
// ─────────────────────────────────────────────────────────────────────────────

function getSeedForProduct(productId: string, zoneId: string): number {
  // Simple deterministic hash — keeps framing identical across all colour variants
  let hash = 0;
  const str = `${productId}:${zoneId}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2_147_483_647 || 42;
}

// ─────────────────────────────────────────────────────────────────────────────
// Params
// ─────────────────────────────────────────────────────────────────────────────

export interface FluxGenerationParams {
  shopId:           string;
  shopDomain:       string;
  productId:        string;
  zoneId:           string;
  shopifyProductId: string;
  fabricFamily:     string;
  colourName:       string;
  swatchId?:        string | null;
  /** Public HTTP(S) URL of the product image */
  productImageUrl:  string;
  /** Public HTTP(S) URL of the swatch image — used to extract hex colour */
  swatchImageUrl?:  string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────────────────────

export async function runFluxGeneration(
  params: FluxGenerationParams,
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
    swatchImageUrl,
  } = params;
  let { swatchId } = params;

  if (!isFluxEnabled()) {
    throw new Error("[flux] FLUX HD generation is not enabled on this server.");
  }

  await onProgress?.(5);

  const fal = await getFalClient();

  // ── Step 1: Download product image ────────────────────────────────────
  const productRes = await fetch(params.productImageUrl);
  if (!productRes.ok) {
    throw new Error(`[flux] Failed to download product image: ${productRes.status}`);
  }
  const productBuffer = Buffer.from(await productRes.arrayBuffer());

  await onProgress?.(15);

  // ── Step 2: Extract hex colour from swatch ─────────────────────────────
  let hex = "#808080"; // fallback grey
  if (swatchImageUrl) {
    try {
      const swatchRes = await fetch(swatchImageUrl);
      if (swatchRes.ok) {
        const swatchBuffer = Buffer.from(await swatchRes.arrayBuffer());
        hex = await swatchToHex(swatchBuffer);
      }
    } catch (err) {
      console.warn("[flux] Could not extract hex from swatch, using fallback:", err);
    }
  }

  const prompt = buildKontextPrompt(fabricFamily, colourName, hex);
  const seed   = getSeedForProduct(productId, zoneId);

  console.log(
    `[flux] starting Kontext render — ${fabricFamily}/${colourName} ${hex} ` +
    `| seed=${seed} | prompt: "${prompt.slice(0, 80)}..."`,
  );

  await onProgress?.(25);

  // ── Step 3: Upload product image to fal.ai storage ────────────────────
  const uploadedImageUrl = await fal.storage.upload(
    new File([productBuffer], "product.jpg", { type: "image/jpeg" }),
  );

  await onProgress?.(35);

  // ── Step 4: Run Kontext ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (fal as any).subscribe(FAL_MODEL, {
    input: {
      image_url:           uploadedImageUrl,
      prompt,
      num_inference_steps: 35,   // was 28 — sharper fabric detail
      guidance_scale:      4.0,  // was 2.5 — follows the texture instruction much more closely
      safety_tolerance:    "6",
      seed,                      // deterministic per product+zone — keeps framing identical across colours
    },
    logs: false,
    onQueueUpdate: async (update: { status: string }) => {
      if (update.status === "IN_QUEUE")    await onProgress?.(40);
      if (update.status === "IN_PROGRESS") await onProgress?.(60);
    },
  });

  await onProgress?.(75);

  // ── Step 5: Validate response ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generatedUrl: string | undefined = (result as any)?.data?.images?.[0]?.url;
  if (!generatedUrl) {
    throw new Error(
      `[flux] fal.ai returned no image URL. ` +
      `Raw: ${JSON.stringify(result).slice(0, 300)}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputMeta = (result as any)?.data?.images?.[0];
  const outWidth:  number = outputMeta?.width  ?? 1104;
  const outHeight: number = outputMeta?.height ?? 944;

  // ── Step 6: Download generated image ──────────────────────────────────
  const imageRes = await fetch(generatedUrl);
  if (!imageRes.ok) {
    throw new Error(`[flux] Failed to download generated image: ${imageRes.status}`);
  }
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  await onProgress?.(85);

  // ── Step 7: Upload to R2 ──────────────────────────────────────────────
  const safeProduct = safeFolderName(shopifyProductId);
  const safeFamily  = slugify(fabricFamily);
  const safeColour  = slugify(colourName);

  const storagePath = [
    shopDomain,
    "products",
    safeProduct,
    "zones",
    zoneId,
    `${safeFamily}__${safeColour}__hd.jpg`,
  ].join("/");

  const uploaded = await uploadBufferToStorage({
    path:        storagePath,
    buffer:      imageBuffer,
    contentType: "image/jpeg",
    upsert:      true,
  });

  await onProgress?.(93);

  // ── Step 8: Upsert Preview record ─────────────────────────────────────
  const preview = await prisma.preview.upsert({
    where: {
      productId_zoneId_fabricFamily_colourName: {
        productId,
        zoneId,
        fabricFamily,
        colourName,
      },
    },
    update: {
      swatchId:  swatchId ?? undefined,
      imagePath: uploaded.path,
      imageUrl:  uploaded.publicUrl,
      width:     outWidth,
      height:    outHeight,
    },
    create: {
      shopId,
      productId,
      zoneId,
      swatchId:              swatchId ?? undefined,
      shopifyProductId,
      fabricFamily,
      colourName,
      imagePath:             uploaded.path,
      imageUrl:              uploaded.publicUrl,
      width:                 outWidth,
      height:                outHeight,
      status:                "DRAFT",
      approvedForStorefront: false,
      featured:              false,
    },
  });

  await onProgress?.(100);

  console.log(
    `[flux] Kontext render done — ${fabricFamily}/${colourName} ` +
    `${outWidth}×${outHeight} → ${uploaded.publicUrl}`,
  );

  return {
    previewId:    preview.id,
    previewUrl:   uploaded.publicUrl,
    imagePath:    uploaded.path,
    fabricFamily: preview.fabricFamily,
    colourName:   preview.colourName,
    width:        outWidth,
    height:       outHeight,
    swatchId:     swatchId ?? null,
  };
}
