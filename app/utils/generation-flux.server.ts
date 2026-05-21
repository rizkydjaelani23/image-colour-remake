/**
 * FLUX.1-Fill HD generation — photorealistic fabric colour previews via fal.ai
 *
 * ── SAFETY DESIGN ───────────────────────────────────────────────────────────
 * This file is completely isolated from the existing Sharp pipeline.
 * It is NEVER called by any existing code path.
 *
 * To enable:  set FLUX_HD_ENABLED=true  AND  FAL_KEY=<your-fal-api-key>
 *             in Railway env vars (or .env for local testing).
 *
 * When disabled (default): isFluxEnabled() returns false and all callers
 * must check this before calling runFluxGeneration(). The fal.ai package
 * is imported lazily — the server never touches it unless a call is made.
 *
 * Returns the same GenerationResult type as generation-core.server.ts so
 * it can be a drop-in when wired into the worker in Phase 2.
 * ────────────────────────────────────────────────────────────────────────────
 */

import prisma from "./db.server";
import { uploadBufferToStorage } from "./storage.server";
import { slugify } from "./generation-core.server";
import { safeFolderName } from "./visualiser.server";
import type { GenerationResult } from "./generation-core.server";

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag
// Both conditions must be true — missing either one keeps the feature off.
// ─────────────────────────────────────────────────────────────────────────────

export function isFluxEnabled(): boolean {
  return (
    process.env.FLUX_HD_ENABLED === "true" &&
    typeof process.env.FAL_KEY === "string" &&
    process.env.FAL_KEY.trim().length > 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// fal.ai model endpoint
// FLUX.1 [pro] Fill — $0.05 per megapixel (1024×1024 = $0.05/image)
// ─────────────────────────────────────────────────────────────────────────────

const FAL_MODEL = "fal-ai/flux-pro/v1/fill" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Lazy client — only initialised on first actual call, never on server boot
// ─────────────────────────────────────────────────────────────────────────────

async function getFalClient() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error(
      "[flux] FAL_KEY env var is not set. " +
      "Add it to Railway env vars before enabling FLUX_HD_ENABLED.",
    );
  }

  // Dynamic import so the server never loads this package unless
  // a HD generation is actually requested.
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: key });
  return fal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder — fabric family + colour name → FLUX inpainting prompt
// ─────────────────────────────────────────────────────────────────────────────

const FABRIC_DESCRIPTORS: Record<string, string> = {
  plush:    "plush velvet upholstery with soft directional pile and subtle sheen",
  velvet:   "crushed velvet upholstery with natural shimmer and pile variation",
  mink:     "plush mink velvet upholstery, ultra-soft with luxurious sheen",
  suede:    "microfibre suede upholstery with fine matte texture",
  venice:   "venice woven fabric upholstery with refined texture",
  boucle:   "bouclé fabric upholstery with looped wool texture",
  chenille: "chenille upholstery with ribbed pile texture",
};

function buildFabricPrompt(fabricFamily: string, colourName: string): string {
  const familyLower = fabricFamily.toLowerCase().trim();

  const textureDesc =
    Object.entries(FABRIC_DESCRIPTORS).find(([key]) =>
      familyLower.includes(key),
    )?.[1] ?? `${fabricFamily.trim()} fabric upholstery`;

  return (
    `photorealistic ${colourName.trim()} ${textureDesc}, ` +
    `accurate fabric colour, natural studio lighting with correct shadows and highlights, ` +
    `photorealistic furniture product photography, high detail, 4k`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FluxGenerationParams {
  shopId:          string;
  shopDomain:      string;
  productId:       string;
  zoneId:          string;
  shopifyProductId: string;
  fabricFamily:    string;
  colourName:      string;
  swatchId?:       string | null;
  /** Public HTTP(S) URL of the base product image (Shopify CDN or R2) */
  productImageUrl: string;
  /**
   * Public HTTP(S) URL of the zone mask image.
   * WHITE pixels = area to replace with new fabric.
   * BLACK pixels = keep original image unchanged.
   * Must be a public URL — local paths are not supported by fal.ai.
   */
  maskUrl: string;
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
  } = params;
  let { swatchId } = params;

  // Guard — callers should check isFluxEnabled() first, but be safe here too
  if (!isFluxEnabled()) {
    throw new Error("[flux] FLUX HD generation is not enabled on this server.");
  }

  // Guard — fal.ai requires a public URL for the mask
  if (!params.maskUrl.startsWith("http")) {
    throw new Error(
      `[flux] Zone mask must be a public URL for HD rendering. ` +
      `Got: "${params.maskUrl}". ` +
      `Re-save the zone to upload the mask to R2 first.`,
    );
  }

  await onProgress?.(10);

  const fal    = await getFalClient();
  const prompt = buildFabricPrompt(fabricFamily, colourName);

  console.log(
    `[flux] starting HD render — ${fabricFamily}/${colourName}` +
    ` | prompt: "${prompt.slice(0, 80)}..."`,
  );

  await onProgress?.(20);

  // ── Call fal.ai FLUX.1-Fill ─────────────────────────────────────────────
  // fal.subscribe() submits the job and polls until complete (default 500ms interval).
  // Typical wall-clock time: 6–15 seconds at default image dimensions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (fal as any).subscribe(FAL_MODEL, {
    input: {
      image_url:           params.productImageUrl,
      mask_url:            params.maskUrl,
      prompt,
      num_inference_steps: 28,    // quality / speed sweet spot for FLUX Pro Fill
      guidance_scale:      3.5,   // recommended value for FLUX.1
      output_format:       "jpeg", // JPEG: smaller files, negligible quality loss for previews
      // Resolution: omitted — fal.ai uses the input image's natural dimensions.
      // Billing = megapixels of OUTPUT image, rounded up.
    },
    logs: false,
    onQueueUpdate: async (update: { status: string }) => {
      if (update.status === "IN_QUEUE")     await onProgress?.(30);
      if (update.status === "IN_PROGRESS")  await onProgress?.(55);
    },
  });

  await onProgress?.(75);

  // ── Validate response ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generatedUrl: string | undefined = (result as any)?.data?.images?.[0]?.url;
  if (!generatedUrl) {
    throw new Error(
      `[flux] fal.ai returned no image URL. ` +
      `Raw response: ${JSON.stringify(result).slice(0, 300)}`,
    );
  }

  // ── Download generated image ────────────────────────────────────────────
  const imageResponse = await fetch(generatedUrl);
  if (!imageResponse.ok) {
    throw new Error(
      `[flux] Failed to download generated image from fal.ai: ` +
      `${imageResponse.status} ${imageResponse.statusText}`,
    );
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  await onProgress?.(85);

  // ── Upload to R2 ────────────────────────────────────────────────────────
  // Uses the same path structure as Sharp previews but adds an "__hd" suffix.
  // This keeps HD renders separate from Sharp renders in storage — both can
  // coexist during the transition period.
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

  // ── Upsert Preview record ───────────────────────────────────────────────
  // Updates the existing preview (same product/zone/fabric/colour) with the
  // new HD URL. If no preview exists yet, creates one in DRAFT status.
  // The merchant's approval status is preserved on update (we only change
  // imagePath + imageUrl, not status/featured/approvedForStorefront).
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
    },
    create: {
      shopId,
      productId,
      zoneId,
      swatchId:             swatchId ?? undefined,
      shopifyProductId,
      fabricFamily,
      colourName,
      imagePath:            uploaded.path,
      imageUrl:             uploaded.publicUrl,
      status:               "DRAFT",
      approvedForStorefront: false,
      featured:             false,
    },
  });

  await onProgress?.(100);

  console.log(
    `[flux] HD render done — ${fabricFamily}/${colourName} ` +
    `→ ${uploaded.publicUrl}`,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputMeta = (result as any)?.data?.images?.[0];

  return {
    previewId:    preview.id,
    previewUrl:   uploaded.publicUrl,
    imagePath:    uploaded.path,
    fabricFamily: preview.fabricFamily,
    colourName:   preview.colourName,
    width:        outputMeta?.width  ?? 1024,
    height:       outputMeta?.height ?? 1024,
    swatchId:     swatchId ?? null,
  };
}
