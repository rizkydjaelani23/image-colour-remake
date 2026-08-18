import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { isSupportInboxOwner } from "../utils/support-owner.server";

// POST /api/support-reply — OWNER ONLY: reply to a merchant conversation.
// Without this gate, any authenticated shop could post into ANY other shop's
// support chat, appearing as "support" — a cross-tenant impersonation risk on
// top of the read leak.
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (!isSupportInboxOwner(session.shop)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { conversationId, body } = await request.json() as {
    conversationId?: string;
    body?: string;
  };

  if (!conversationId) return Response.json({ error: "Missing conversationId" }, { status: 400 });
  if (!body?.trim())   return Response.json({ error: "Reply body is required" }, { status: 400 });

  const conv = await prisma.supportConversation.findUnique({ where: { id: conversationId } });
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });

  const msg = await prisma.supportMessage.create({
    data: { conversationId, body: body.trim(), sender: "support" },
  });

  // Update conversation timestamp so it floats to top
  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return Response.json({ message: msg });
}
