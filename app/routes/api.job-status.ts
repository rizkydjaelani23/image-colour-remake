/**
 * GET /api/job-status?jobId=<id>
 *  or
 * GET /api/job-status?productId=<shopifyGID>&shopId=<dbShopId>
 *
 * Returns current status of one job, or all active jobs for a product.
 * Authenticated via Shopify session — merchant can only see their own jobs.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain  = session.shop;
    const shop        = await getOrCreateShop(shopDomain);

    const url     = new URL(request.url);
    const jobId   = url.searchParams.get("jobId");
    const prodGid = url.searchParams.get("productId"); // Shopify GID

    if (jobId) {
      // Single job lookup
      const job = await prisma.generationJob.findFirst({
        where: { id: jobId, shopId: shop.id },
        select: {
          id:           true,
          status:       true,
          progress:     true,
          fabricFamily: true,
          colourName:   true,
          previewId:    true,
          previewUrl:   true,
          errorMessage: true,
          createdAt:    true,
          startedAt:    true,
          completedAt:  true,
          shopifyProductId: true,
        },
      });

      if (!job) {
        return Response.json({ error: "Job not found" }, { status: 404 });
      }

      return Response.json({ job });
    }

    if (prodGid) {
      // All active jobs for a product (for the product picker status display)
      const jobs = await prisma.generationJob.findMany({
        where: {
          shopId: shop.id,
          product: { shopifyProductId: prodGid },
          status: { in: ["PENDING", "PROCESSING"] },
        },
        select: {
          id:          true,
          status:      true,
          progress:    true,
          fabricFamily: true,
          colourName:  true,
          zoneId:      true,
          createdAt:   true,
        },
        orderBy: { createdAt: "asc" },
      });

      return Response.json({ jobs });
    }

    // Return all active jobs for this shop (for the dashboard overview)
    const allActive = await prisma.generationJob.findMany({
      where: {
        shopId: shop.id,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      select: {
        id:           true,
        status:       true,
        progress:     true,
        fabricFamily: true,
        colourName:   true,
        zoneId:       true,
        productId:    true,
        shopifyProductId: true,
        createdAt:    true,
      },
      orderBy: { createdAt: "asc" },
    });

    return Response.json({ jobs: allActive });
  } catch (err) {
    console.error("api.job-status error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
