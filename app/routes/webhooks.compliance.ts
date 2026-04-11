import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  let topic: string;
  let shop: string;

  try {
    const result = await authenticate.webhook(request);
    topic = result.topic;
    shop = result.shop;
  } catch (error) {
    console.error("HMAC verification failed:", error);

    // 🔥 THIS IS CRITICAL
    return new Response("Unauthorized", { status: 401 });
  }

  try {
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
        return new Response("Unhandled topic", { status: 200 });
    }
  } catch (error) {
    console.error("Webhook processing failed:", error);

    // Optional fallback
    return new Response("Server error", { status: 200 });
  }
}