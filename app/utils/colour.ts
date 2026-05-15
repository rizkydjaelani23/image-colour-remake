/**
 * Pure colour-name helpers — no server dependencies, safe to import anywhere.
 */

/**
 * Converts a fabric colour name to a URL-safe slug.
 * e.g. "Silver Crushed Velvet" → "silver-crushed-velvet"
 *      "Plush Blue (Soft)" → "plush-blue-soft"
 */
export function colourToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Returns the Shopify tag we write to a product for a given colour.
 * e.g. "Plush Blue" → "fabric-plush-blue"
 *
 * The `fabric-` prefix ensures our tags never collide with merchant tags
 * and can be cleanly removed/filtered on uninstall.
 */
export function colourToFabricTag(name: string): string {
  return `fabric-${colourToSlug(name)}`;
}

/**
 * Returns the Shopify collection handle we use for a colour's collection page.
 * e.g. "Plush Blue" → "fabric-plush-blue"
 */
export function colourToCollectionHandle(name: string): string {
  return `fabric-${colourToSlug(name)}`;
}
