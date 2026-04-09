import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Return 200 quickly. Implement data export flow if needed.
      break;

    case "CUSTOMERS_REDACT":
      // Delete or anonymize customer data if you store any.
      break;

    case "SHOP_REDACT":
      // Delete shop data on uninstall/privacy request.
      await prisma.session.deleteMany({ where: { shop } });
      // Add any other cleanup you need here
      break;

    default:
      return new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response(null, { status: 200 });
}