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
    {
      headers: {
        // Never cache — replies must appear immediately on the next poll
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    }
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

  // Forward to Google Chat webhook as a card (fire and forget)
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (webhookUrl) {
    const timestamp = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
    const inboxUrl  = `https://image-colour-remake-production.up.railway.app/app/support-inbox?conv=${conv.id}`;
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cardsV2: [{
          cardId: `support-${msg.id}`,
          card: {
            header: {
              title: "🛎️ New support message",
              subtitle: session.shop,
            },
            sections: [
              {
                widgets: [
                  {
                    decoratedText: {
                      topLabel: "Message",
                      text: body.trim(),
                      wrapText: true,
                    },
                  },
                  {
                    decoratedText: {
                      topLabel: "Time",
                      text: `${timestamp} AEST`,
                    },
                  },
                ],
              },
              {
                header: "⚠️  Reply inside the app — replies typed here won't reach the customer",
                widgets: [
                  {
                    buttonList: {
                      buttons: [
                        {
                          text: "💬 Open Support Inbox & Reply",
                          onClick: { openLink: { url: inboxUrl } },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        }],
      }),
    }).catch((e) => console.error("Google Chat webhook error:", e));
  }

  return Response.json({
    message: msg,
    autoReply: autoMsg,
  });
}
