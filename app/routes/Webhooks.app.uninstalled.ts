import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await authenticate.webhook(request);

    await prisma.session.deleteMany({
      where: { shop },
    });

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("App uninstall webhook HMAC validation failed:", error);
    return new Response("Unauthorized", { status: 401 });
  }
}