import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import fs from "node:fs/promises";
import path from "node:path";

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function saveUploadedFile(file: File, destinationPath: string) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(destinationPath, buffer);
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    await authenticate.admin(request);

    const formData = await request.formData();

    const productId = formData.get("productId");
    const masterImage = formData.get("masterImage");
    const maskImage = formData.get("maskImage");
    const swatches = formData.getAll("swatches");

    if (!productId || typeof productId !== "string") {
      return Response.json({ error: "Missing product ID" }, { status: 400 });
    }

    if (!(masterImage instanceof File) || masterImage.size === 0) {
      return Response.json({ error: "Master image is required" }, { status: 400 });
    }

    if (!(maskImage instanceof File) || maskImage.size === 0) {
      return Response.json({ error: "Mask image is required" }, { status: 400 });
    }

    const uploadsRoot = path.join(process.cwd(), "public", "uploads");
    const productFolderName = productId.replace(/[^a-zA-Z0-9]/g, "_");
    const productFolder = path.join(uploadsRoot, productFolderName);
    const swatchesFolder = path.join(productFolder, "swatches");

    await ensureDir(productFolder);
    await ensureDir(swatchesFolder);

    const masterFileName = `master-${Date.now()}-${safeFileName(masterImage.name)}`;
    const maskFileName = `mask-${Date.now()}-${safeFileName(maskImage.name)}`;

    const masterDestination = path.join(productFolder, masterFileName);
    const maskDestination = path.join(productFolder, maskFileName);

    await saveUploadedFile(masterImage, masterDestination);
    await saveUploadedFile(maskImage, maskDestination);

    const savedSwatches: Array<{ name: string; url: string }> = [];

    for (const swatch of swatches) {
      if (!(swatch instanceof File) || swatch.size === 0) continue;

      const swatchFileName = `swatch-${Date.now()}-${safeFileName(swatch.name)}`;
      const swatchDestination = path.join(swatchesFolder, swatchFileName);

      await saveUploadedFile(swatch, swatchDestination);

      savedSwatches.push({
        name: swatch.name,
        url: `/uploads/${productFolderName}/swatches/${swatchFileName}`,
      });
    }

    return Response.json({
      success: true,
      uploaded: {
        productId,
        masterImage: {
          name: masterImage.name,
          url: `/uploads/${productFolderName}/${masterFileName}`,
        },
        maskImage: {
          name: maskImage.name,
          url: `/uploads/${productFolderName}/${maskFileName}`,
        },
        swatches: savedSwatches,
      },
    });
  } catch (error) {
    console.error("api.upload-assets error:", error);

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unknown upload error",
      },
      { status: 500 },
    );
  }
}