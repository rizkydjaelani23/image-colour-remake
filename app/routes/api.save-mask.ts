import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import fs from "node:fs/promises";
import path from "node:path";

function safeFolderName(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "_");
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    await authenticate.admin(request);

    const formData = await request.formData();
    const productId = formData.get("productId");
    const maskFile = formData.get("mask");

    if (!productId || typeof productId !== "string") {
      return Response.json({ error: "Missing product ID" }, { status: 400 });
    }

    if (!(maskFile instanceof File) || maskFile.size === 0) {
      return Response.json({ error: "Missing mask file" }, { status: 400 });
    }

    const productFolderName = safeFolderName(productId);
    const uploadsRoot = path.join(process.cwd(), "public", "uploads");
    const productFolder = path.join(uploadsRoot, productFolderName);

    await ensureDir(productFolder);

    const fileName = `mask-${Date.now()}.png`;
    const destination = path.join(productFolder, fileName);

    const arrayBuffer = await maskFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.writeFile(destination, buffer);

    return Response.json({
      success: true,
      mask: {
        url: `/uploads/${productFolderName}/${fileName}`,
      },
    });
  } catch (error) {
    console.error("api.save-mask error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error while saving mask",
      },
      { status: 500 },
    );
  }
}