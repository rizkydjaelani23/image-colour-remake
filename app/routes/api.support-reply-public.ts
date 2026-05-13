/**
 * POST /api/support-reply-public
 * Token-authenticated (no Shopify session needed).
 * Used by the standalone support-reply page so the POST goes to a pure
 * API route — not back to the page route — avoiding React Router returning
 * HTML instead of JSON when a route has a React component.
 */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../utils/db.server";

function getSecret() {
  return process.env.SUPPORT_REPLY_SECRET || "change-me-please";
}

export async function action({ request }: ActionFunctionArgs) {
  const { token = "", conversationId = "", body: rawBody = "" } =
    (await request.json()) as { token?: string; conversationId?: string; body?: string };

  if (!token || token !== getSecret()) {
    return Response.json({ ok: false, error: "Invalid token." }, { status: 401 });
  }

  const body = rawBody.trim();
  if (!body) {
    return Response.json({ ok: false, error: "Reply cannot be empty." }, { status: 400 });
  }
  if (!conversationId) {
    return Response.json({ ok: false, error: "Missing conversationId." }, { status: 400 });
  }

  const conv = await prisma.supportConversation.findUnique({ where: { id: conversationId } });
  if (!conv) {
    return Response.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  const newMsg = await prisma.supportMessage.create({
    data: { conversationId, body, sender: "support" },
  });

  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return Response.json({
    ok: true,
    message: {
      id:        newMsg.id,
      body:      newMsg.body,
      sender:    newMsg.sender,
      createdAt: newMsg.createdAt.toISOString(),
    },
  });
}
