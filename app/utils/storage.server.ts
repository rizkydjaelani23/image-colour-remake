// Storage abstraction — backed by Cloudflare R2
// Drop-in replacement for the previous Supabase storage implementation.
// All callers (api.upload-preview, api.save-zone, api.generate-preview, etc.)
// continue to call uploadBufferToStorage / deleteFileFromStorage unchanged.

import { r2Upload, r2Delete } from "./r2.server";

export async function uploadBufferToStorage(params: {
  path: string;
  buffer: Buffer;
  contentType?: string;
  upsert?: boolean; // kept for API compatibility — R2 always overwrites
}) {
  const { path, buffer, contentType = "image/webp" } = params;
  return r2Upload({ path, buffer, contentType });
}

export async function deleteFileFromStorage(path: string) {
  return r2Delete(path);
}
