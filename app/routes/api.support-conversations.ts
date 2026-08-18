import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { isSupportInboxOwner } from "../utils/support-owner.server";

// GET /api/support-conversations — OWNER ONLY: list all conversations with messages.
// This is a cross-shop view by design (the owner's unified inbox) — must never
// be reachable by a regular merchant shop.
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!isSupportInboxOwner(session.shop)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const conversations = await prisma.supportConversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return Response.json(
    { conversations },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

// POST /api/support-conversations — OWNER ONLY: close a conversation
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!isSupportInboxOwner(session.shop)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

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
