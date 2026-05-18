/**
 * One-time migration: Supabase Storage → Cloudflare R2
 *
 * What it does:
 *  1. Reads every image path/URL stored in the database (Preview, Swatch, Zone)
 *  2. Downloads each file from Supabase public storage
 *  3. Re-uploads it to Cloudflare R2 with the same key/path
 *  4. Updates every DB URL to point at R2
 *
 * Run AFTER adding R2 env vars to .env and deploying the new storage code:
 *   node scripts/migrate-to-r2.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

// ── Load .env ──────────────────────────────────────────────────────────────
try {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn("Could not load .env — assuming env vars are already set.");
}

// ── Validate env vars ──────────────────────────────────────────────────────
const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_URL",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("❌ Missing env vars:", missing.join(", "));
  process.exit(1);
}

// ── Clients ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-previews";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || "product-previews";
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_URL.replace(/\/$/, "");

const prisma = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract the relative storage key from a Supabase public URL */
function supabaseUrlToKey(url) {
  if (!url) return null;
  // Pattern: .../storage/v1/object/public/<bucket>/<key>
  const marker = `/object/public/${SUPABASE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

/** Download a file from Supabase by its storage key, return a Buffer */
async function downloadFromSupabase(key) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .download(key);
  if (error) throw new Error(`Supabase download failed (${key}): ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Guess content-type from file extension */
function guessContentType(key) {
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".png"))  return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".gif"))  return "image/gif";
  return "application/octet-stream";
}

/** Upload a Buffer to R2 and return the new public URL */
async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${R2_PUBLIC_BASE}/${key}`;
}

/** Migrate a single URL: download from Supabase, upload to R2, return new URL */
async function migrateUrl(supabaseUrl) {
  if (!supabaseUrl) return null;

  // Already migrated (already an R2 URL)
  if (supabaseUrl.startsWith(R2_PUBLIC_BASE)) {
    return supabaseUrl;
  }

  const key = supabaseUrlToKey(supabaseUrl);
  if (!key) {
    console.warn(`  ⚠ Could not parse key from URL: ${supabaseUrl}`);
    return supabaseUrl; // leave unchanged
  }

  const buffer = await downloadFromSupabase(key);
  const contentType = guessContentType(key);
  const newUrl = await uploadToR2(key, buffer, contentType);
  return newUrl;
}

// ── Migration ──────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 Starting Supabase → R2 migration\n");

  const errors = [];
  let total = 0;
  let done = 0;

  // ── Previews ──────────────────────────────────────────────────────────
  console.log("📦 Fetching previews from DB...");
  const previews = await prisma.preview.findMany({
    select: { id: true, imagePath: true, imageUrl: true, thumbUrl: true },
  });
  console.log(`   Found ${previews.length} previews`);
  total += previews.length;

  for (const preview of previews) {
    process.stdout.write(`  Preview ${preview.id.slice(0, 8)}… `);
    try {
      const newImageUrl = await migrateUrl(preview.imageUrl);
      const newThumbUrl = await migrateUrl(preview.thumbUrl);

      await prisma.preview.update({
        where: { id: preview.id },
        data: { imageUrl: newImageUrl, thumbUrl: newThumbUrl },
      });

      done++;
      console.log("✅");
    } catch (err) {
      console.log("❌", err.message);
      errors.push({ type: "preview", id: preview.id, error: err.message });
    }
  }

  // ── Swatches ──────────────────────────────────────────────────────────
  console.log("\n📦 Fetching swatches from DB...");
  const swatches = await prisma.swatch.findMany({
    select: { id: true, imagePath: true, imageUrl: true },
  });
  console.log(`   Found ${swatches.length} swatches`);
  total += swatches.length;

  for (const swatch of swatches) {
    process.stdout.write(`  Swatch ${swatch.id.slice(0, 8)}… `);
    try {
      const newImageUrl = await migrateUrl(swatch.imageUrl);

      await prisma.swatch.update({
        where: { id: swatch.id },
        data: { imageUrl: newImageUrl },
      });

      done++;
      console.log("✅");
    } catch (err) {
      console.log("❌", err.message);
      errors.push({ type: "swatch", id: swatch.id, error: err.message });
    }
  }

  // ── Zone masks ────────────────────────────────────────────────────────
  console.log("\n📦 Fetching zone masks from DB...");
  const zones = await prisma.zone.findMany({
    where: { maskPath: { not: null } },
    select: { id: true, maskPath: true },
  });
  console.log(`   Found ${zones.length} zones with masks`);
  total += zones.length;

  for (const zone of zones) {
    process.stdout.write(`  Zone ${zone.id.slice(0, 8)}… `);
    try {
      const newMaskUrl = await migrateUrl(zone.maskPath);

      await prisma.zone.update({
        where: { id: zone.id },
        data: { maskPath: newMaskUrl },
      });

      done++;
      console.log("✅");
    } catch (err) {
      console.log("❌", err.message);
      errors.push({ type: "zone", id: zone.id, error: err.message });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ Migrated: ${done} / ${total}`);

  if (errors.length > 0) {
    console.log(`❌ Failed:   ${errors.length}`);
    const logPath = "scripts/migrate-errors.json";
    writeFileSync(logPath, JSON.stringify(errors, null, 2));
    console.log(`   Errors saved to ${logPath} — re-run to retry`);
  } else {
    console.log("\n🎉 All files migrated successfully!");
    console.log("   You can now remove SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env");
    console.log("   and uninstall @supabase/supabase-js when ready.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
