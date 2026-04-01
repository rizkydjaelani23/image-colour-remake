import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function getProductFolder(productId: string) {
  return path.join(process.cwd(), "public", "uploads", safeFolderName(productId));
}

export function getZonesFolder(productId: string) {
  return path.join(getProductFolder(productId), "zones");
}

export function safeFolderName(input: string) {
  return input
    .replace("gid://shopify/Product/", "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

export function getConfigPath(productId: string) {
  return path.join(getProductFolder(productId), "config.json");
}

export async function readProductConfig(productId: string) {
  try {
    const file = await fs.readFile(getConfigPath(productId), "utf8");
    return JSON.parse(file);
  } catch {
    return null;
  }
}

export async function writeProductConfig(config: any) {
  const productFolder = getProductFolder(config.productId);
  await ensureDir(productFolder);
  await fs.writeFile(getConfigPath(config.productId), JSON.stringify(config, null, 2), "utf8");
}

export async function upsertZone(productId: string, baseImageUrl: string, zone: any) {
  const existing = await readProductConfig(productId);

  const config = existing ?? {
    productId,
    baseImageUrl,
    zones: [],
  };

  config.baseImageUrl = baseImageUrl;

  const index = config.zones.findIndex((z: any) => z.id === zone.id);

  if (index >= 0) {
    config.zones[index] = zone;
  } else {
    config.zones.push(zone);
  }

  await writeProductConfig(config);
  return config;
}