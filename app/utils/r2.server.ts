import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
  );
}

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export const R2_BUCKET = process.env.R2_BUCKET_NAME || "product-previews";

// Public base URL for serving files — set to your R2 public domain or r2.dev URL
// e.g. https://pub-XXXX.r2.dev  OR  https://cdn.poweryourhouse.io
const rawPublicUrl = process.env.R2_PUBLIC_URL || "";
export const R2_PUBLIC_BASE = rawPublicUrl.replace(/\/$/, "");

export async function r2Upload(params: {
  path: string;
  buffer: Buffer;
  contentType?: string;
}) {
  const { path, buffer, contentType = "image/webp" } = params;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: path,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return {
    path,
    publicUrl: `${R2_PUBLIC_BASE}/${path}`,
  };
}

export async function r2Delete(path: string) {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: path,
    }),
  );
}
