import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

const AUTO_REPLY = "Thanks for reaching out! 👋 We're on it and will be with you shortly.";

// GET /api/support-chat — fetch or create conversation + all messages for this shop
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  let conv = await prisma.supportConversation.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return Response.json(
    {
      conversation: conv
        ? { id: conv.id, status: conv.status, shopDomain: conv.shopDomain }
        : null,
      messages: conv?.messages ?? [],
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" } }
  );
}

// POST /api/support-chat — merchant sends a message
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { body } = await request.json() as { body?: string };
  if (!body?.trim()) return Response.json({ error: "Message is required" }, { status: 400 });

  // Find or create conversation
  let conv = await prisma.supportConversation.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const isNewConversation = !conv;

  if (!conv) {
    conv = await prisma.supportConversation.create({
      data: { shopId: shop.id, shopDomain: session.shop, status: "open" },
    });
  } else if (conv.status === "closed") {
    // Reopen closed conversations when merchant writes again
    conv = await prisma.supportConversation.update({
      where: { id: conv.id },
      data: { status: "open" },
    });
  }

  // Save merchant message
  const msg = await prisma.supportMessage.create({
    data: { conversationId: conv.id, body: body.trim(), sender: "merchant" },
  });

  // Auto-reply on first message of a conversation
  let autoMsg = null;
  if (isNewConversation) {
    autoMsg = await prisma.supportMessage.create({
      data: { conversationId: conv.id, body: AUTO_REPLY, sender: "system" },
    });
  }

  // Forward to Google Chat webhook (fire and forget)
  // Uses Cards v1 format — the only card format supported by incoming webhooks.
  // cardsV2 requires a full Chat bot app and is NOT supported here.
  // The inbox link uses the Shopify admin URL so it opens without re-auth.
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (webhookUrl) {
    const timestamp  = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
    const secret   = process.env.SUPPORT_REPLY_SECRET || "change-me-please";
    const inboxUrl = `https://image-colour-remake-production.up.railway.app/support-reply/${conv.id}?token=${encodeURIComponent(secret)}`;

    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cards: [{
          header: {
            title: "🛎️ New support message",
            subtitle: session.shop,
            imageUrl: "https://fonts.gstatic.com/s/i/googlematerialicons/chat/v6/white-24dp/1x/gm_chat_white_24dp.png",
          },
          sections: [
            {
              widgets: [
                {
                  keyValue: {
                    topLabel: "Message",
                    content: body.trim(),
                    contentMultiline: "true",
                  },
                },
                {
                  keyValue: {
                    topLabel: "Time",
                    content: `${timestamp} AEST`,
                  },
                },
                {
                  textParagraph: {
                    text: "<b>⚠️ Reply in the Support Inbox below — do NOT reply in Google Chat or the customer won't see it.</b>",
                  },
                },
              ],
            },
            {
              widgets: [
                {
                  buttons: [
                    {
                      textButton: {
                        text: "💬 Open Support Inbox & Reply",
                        onClick: {
                          openLink: { url: inboxUrl },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }],
      }),
    }).catch((e) => console.error("Google Chat webhook error:", e));
  }

  return Response.json({
    message: msg,
    autoReply: autoMsg,
  });
}
