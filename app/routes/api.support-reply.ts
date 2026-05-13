import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

// POST /api/support-reply — admin sends a reply to a merchant conversation
export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);

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
