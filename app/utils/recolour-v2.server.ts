/**
 * V2 fabric recolour engine.
 *
 * Replaces the old buildRealisticComposite renderer. Two techniques, both pure
 * deterministic pixel maths (no AI, repeatable, product stays pixel-locked):
 *   1. LAB colour transfer — adopt the swatch's exact colour character
 *      (undertone via a/b direction + chroma) while keeping the product's own
 *      shading (highlights, panel seams, shadows).
 *   2. Real swatch texture — overlay the swatch's fabric grain, modulated by
 *      the product's lighting. Amplitude-clamped so no motif can dominate, and
 *      disabled for smooth materials (leather/vinyl) whose embossed swatches
 *      would otherwise tile into a visible grid.
 *
 * Soft mask-alpha blending preserves feathered zone-mask edges.
 */

import sharp from "sharp";

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function rgb2lab(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function lab2rgb(L: number, a: number, b: number): [number, number, number] {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
  const f = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  x = 0.95047 * f(x); y = f(y); z = 1.08883 * f(z);
  const r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const bb = x * 0.0557 + y * -0.2040 + z * 1.0570;
  const G = (c: number) => (c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c);
  return [clamp255(G(r) * 255), clamp255(G(g) * 255), clamp255(G(bb) * 255)];
}

/** Smooth materials must NOT get a tiled fabric-grain overlay (embossed leather
 *  swatches would tile into a visible grid). */
function isSmoothMaterial(text: string): boolean {
  return /leather|vinyl|faux|patent|pvc|pleather|gloss/i.test(text || "");
}

/** Pattern strength: medium-scale motif energy in a swatch. High = a repeating
 *  pattern (damask, embossed) that would tile into a visible grid; low = fine
 *  random grain (velvet, plush, linen) that tiles cleanly. Greyscale → downscale
 *  (kills fine grain) → remove global lighting gradient → std of the residual. */
async function patternStrength(swatchBuffer: Buffer): Promise<number> {
  const base = sharp(swatchBuffer).removeAlpha().greyscale().resize(48, 48, { fit: "fill" });
  const grey = await base.raw().toBuffer();
  const blur = await sharp(await base.png().toBuffer()).blur(8).raw().toBuffer();
  let sum = 0, sum2 = 0;
  const n = grey.length;
  for (let i = 0; i < n; i++) { const r = grey[i] - blur[i]; sum += r; sum2 += r * r; }
  return Math.sqrt(sum2 / n - (sum / n) * (sum / n));
}

/** Grain amount from pattern strength: full below 8, ramps to zero by 16.
 *  Biases toward safety — a slightly flatter fabric beats a tiled grid. */
function texStrengthFor(ps: number): number {
  return 0.6 * Math.max(0, Math.min(1, (16 - ps) / 8));
}

async function swatchStats(swatchBuffer: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(swatchBuffer)
    .resize(64, 64, { fit: "cover" }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let L = 0, a = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [l, aa, bb] = rgb2lab(data[i], data[i + 1], data[i + 2]);
    L += l; a += aa; b += bb; n++;
  }
  return [L / n, a / n, b / n];
}

async function swatchGrain(swatchBuffer: Buffer): Promise<{ sw: number; sh: number; grain: Int16Array }> {
  const detail = await sharp(swatchBuffer).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const blur   = await sharp(swatchBuffer).removeAlpha().greyscale().blur(6).raw().toBuffer({ resolveWithObject: true });
  const sw = detail.info.width, sh = detail.info.height;
  const grain = new Int16Array(sw * sh);
  for (let i = 0; i < grain.length; i++) grain[i] = detail.data[i] - blur.data[i];
  return { sw, sh, grain };
}

export interface RecolourV2Params {
  baseBuffer:   Buffer;
  swatchBuffer: Buffer;
  maskBuffer:   Buffer;      // white = recolour (may be feathered)
  fabricFamily?: string;
  colourName?:   string;
  contrast?:   number;       // texture/shading retention (default 0.95)
  adapt?:      number;       // brightness retarget strength (default 0.85)
  chromaGain?: number;       // colour intensity (default 1.0)
}

/** Returns a recoloured image buffer (JPEG); caller re-encodes as needed. */
export async function recolourV2(params: RecolourV2Params): Promise<Buffer> {
  const { baseBuffer, swatchBuffer, maskBuffer, fabricFamily = "", colourName = "" } = params;
  const contrast   = params.contrast   ?? 0.95;
  const adapt      = params.adapt      ?? 0.85;
  const chromaGain = params.chromaGain ?? 1.0;
  // Grain: 0 for smooth materials; otherwise driven by the swatch's own pattern
  // strength so patterned swatches (damask, embossed) never tile into a grid.
  const texStrength = isSmoothMaterial(`${fabricFamily} ${colourName}`)
    ? 0
    : texStrengthFor(await patternStrength(swatchBuffer));

  const base = sharp(baseBuffer).rotate();
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;

  const m = await sharp(maskBuffer).resize(W, H, { fit: "fill" }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const maskData = m.data;

  const [tL, tA, tB] = await swatchStats(swatchBuffer);
  const Csw = Math.sqrt(tA * tA + tB * tB) || 0.0001;
  const hueA = tA / Csw, hueB = tB / Csw;
  const g = await swatchGrain(swatchBuffer);

  // These per-pixel loops run in JS and can't be expressed in Sharp, so we yield
  // the event loop every CHUNK pixels — otherwise a single generation blocks all
  // HTTP requests (zone/swatch/image loads) until it finishes.
  const CHUNK = 40_000;

  // Pass 1: mean lightness of the masked region
  let sum = 0, count = 0;
  for (let p = 0, i = 0; i < data.length; i += channels, p++) {
    if (p > 0 && p % CHUNK === 0) await new Promise<void>((r) => setImmediate(r));
    if (maskData[p] < 10) continue;
    sum += rgb2lab(data[i], data[i + 1], data[i + 2])[0];
    count++;
  }
  const Lmean = count ? sum / count : 50;

  // Pass 2: recolour, soft-blended by the mask alpha (feathered edges preserved)
  const out = Buffer.from(data);
  for (let p = 0, i = 0; i < data.length; i += channels, p++) {
    if (p > 0 && p % CHUNK === 0) await new Promise<void>((r) => setImmediate(r));
    const mv = maskData[p] / 255;
    if (mv < 0.004) continue;

    const L0 = rgb2lab(data[i], data[i + 1], data[i + 2])[0];

    let Lnew = (tL * adapt + Lmean * (1 - adapt)) + (L0 - Lmean) * contrast;
    let gAdd = g.grain[((p / W | 0) % g.sh) * g.sw + ((p % W) % g.sw)] * (100 / 255) * texStrength;
    if (gAdd > 12) gAdd = 12; else if (gAdd < -12) gAdd = -12;
    Lnew = Math.min(100, Math.max(0, Lnew + gAdd));

    const Ln = Lnew / 100;
    const bell = 4 * Ln * (1 - Ln);
    const Cmag = Csw * chromaGain * (0.45 + 0.55 * bell);
    const [r, gg, bb] = lab2rgb(Lnew, hueA * Cmag, hueB * Cmag);

    // Soft blend recoloured over original by mask alpha
    out[i]     = Math.round(data[i]     * (1 - mv) + r  * mv);
    out[i + 1] = Math.round(data[i + 1] * (1 - mv) + gg * mv);
    out[i + 2] = Math.round(data[i + 2] * (1 - mv) + bb * mv);
  }

  return sharp(out, { raw: { width: W, height: H, channels } }).jpeg({ quality: 92 }).toBuffer();
}
