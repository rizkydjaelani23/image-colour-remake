import { supabaseAdmin, PREVIEW_BUCKET } from "./supabase.server";

export async function uploadBufferToStorage(params: {
  path: string;
  buffer: Buffer;
  contentType?: string;
  upsert?: boolean;
}) {
  const { path, buffer, contentType = "image/webp", upsert = true } = params;

  const { error } = await supabaseAdmin.storage
    .from(PREVIEW_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage
    .from(PREVIEW_BUCKET)
    .getPublicUrl(path);

  return {
    path,
    publicUrl: data.publicUrl,
  };
}

export async function deleteFileFromStorage(path: string) {
  const { error } = await supabaseAdmin.storage
    .from(PREVIEW_BUCKET)
    .remove([path]);

  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}