// app/routes/webhooks.app.uninstalled.ts

import { json } from "@remix-run/node";
import prisma from "~/db.server";

export const action = async ({ request }) => {
  const shop = request.headers.get("x-shopify-shop-domain");

  if (shop) {
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.preview.deleteMany({ where: { shopId: shop } });
  }

  return json({ success: true });
};