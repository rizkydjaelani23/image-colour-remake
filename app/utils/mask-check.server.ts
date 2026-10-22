import sharp from "sharp";

/**
 * A zone mask is a black image where white marks the area to recolour.
 * If nothing is white, a render would just return the original photo (this is
 * what happens when someone outlines a product but never clicks "Finish
 * outline"), so callers use this to reject or fail with a clear message
 * instead of silently producing an unchanged image.
 */
export async function maskHasSelection(maskBuffer: Buffer): Promise<boolean> {
  try {
    const { channels } = await sharp(maskBuffer).greyscale().stats();
    return (channels[0]?.max ?? 0) >= 50;
  } catch {
    // If we can't read it, don't block — the render step will surface the real error.
    return true;
  }
}

export const EMPTY_MASK_MESSAGE =
  "Nothing is selected in this zone yet. Paint over the fabric area, or finish your outline with the Finish outline button, then save the zone again.";
