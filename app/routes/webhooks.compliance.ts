import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST": {
        console.log("customers/data_request received", { shop, payload });

        // If you store customer data, prepare it here.
        // For now, return 200 quickly.
        return new Response(null, { status: 200 });
      }

      case "CUSTOMERS_REDACT": {
        console.log("customers/redact received", { shop, payload });

        // If you store customer data, delete/anonymize it here.
        return new Response(null, { status: 200 });
      }

      case "SHOP_REDACT": {
        console.log("shop/redact received", { shop, payload });

        // Delete app data associated with the shop.
        await prisma.session.deleteMany({
          where: { shop },
        });

        // Add any other cleanup tables you use here
        // Example:
        // await prisma.preview.deleteMany({ where: { shopId: shop } });

        return new Response(null, { status: 200 });
      }

      default: {
        return new Response("Unhandled compliance webhook topic", { status: 404 });
      }
    }
  } catch (error) {
    console.error("Compliance webhook verification failed:", error);
    return new Response("Invalid webhook", { status: 400 });
  }
}