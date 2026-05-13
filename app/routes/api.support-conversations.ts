import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

// GET /api/support-conversations — admin: list all conversations with messages
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const conversations = await prisma.supportConversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return Response.json(
    { conversations },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

// POST /api/support-conversations — admin: close a conversation
export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);

  const { conversationId, action: act } = await request.json() as {
    conversationId?: string;
    action?: string;
  };

  if (!conversationId) return Response.json({ error: "Missing conversationId" }, { status: 400 });

  if (act === "close") {
    const conv = await prisma.supportConversation.update({
      where: { id: conversationId },
      data: { status: "closed" },
    });
    return Response.json({ conversation: conv });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
