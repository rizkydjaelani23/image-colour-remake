import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { topic, shop } = await authenticate.webhook(request);

    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        return new Response(null, { status: 200 });

      case "CUSTOMERS_REDACT":
        return new Response(null, { status: 200 });

      case "SHOP_REDACT":
        await prisma.session.deleteMany({
          where: { shop },
        });
        return new Response(null, { status: 200 });

      default:
        return new Response("Unhandled webhook topic", { status: 404 });
    }
  } catch (error) {
    console.error("Compliance webhook HMAC validation failed:", error);
    return new Response("Unauthorized", { status: 401 });
  }
}