/**
 * GET /api/support-messages-public?token=...&convId=...
 * Token-authenticated (no Shopify session needed).
 * Used by the standalone support-reply page to poll for new messages
 * without hitting the page route (which returns HTML, not JSON).
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../utils/db.server";

function getSecret() {
  return process.env.SUPPORT_REPLY_SECRET || "change-me-please";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url    = new URL(request.url);
  const token  = url.searchParams.get("token") ?? "";
  const convId = url.searchParams.get("convId") ?? "";

  if (!token || token !== getSecret()) {
    return Response.json({ ok: false, error: "Invalid token." }, { status: 401 });
  }

  if (!convId) {
    return Response.json({ ok: false, error: "Missing convId." }, { status: 400 });
  }

  const conv = await prisma.supportConversation.findUnique({
    where: { id: convId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conv) {
    return Response.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }

  return Response.json(
    {
      ok: true,
      messages: conv.messages.map((m) => ({
        id:        m.id,
        body:      m.body,
        sender:    m.sender,
        createdAt: m.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
