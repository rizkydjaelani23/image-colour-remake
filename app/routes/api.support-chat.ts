import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { askSupportAI, supportAiEnabled } from "../utils/support-ai.server";

const AUTO_REPLY = "Thanks for reaching out! 👋 We're on it and will be with you shortly.";
const HANDOFF_REPLY =
  "Thanks, I've passed this to our team. We usually reply within a few hours and you'll see the answer right here in this chat.";

// Cost guard: AI replies per shop per rolling 24h. Past this, messages go
// straight to the team instead.
const AI_DAILY_CAP = 60;
const MAX_BODY     = 2000;

/** A conversation is "human" once the merchant asked for a person, or once
 *  anyone on the team has replied. The AI never speaks in those. */
function isHumanMode(conv: { humanRequested: boolean }, messages: Array<{ sender: string }>) {
  return conv.humanRequested || messages.some((m) => m.sender === "support");
}

/** Ping the team (Google Chat webhook, fire and forget). */
function notifyTeam(opts: {
  shopDomain: string;
  convId:     string;
  title:      string;
  content:    string;
}) {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const timestamp = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  const secret    = process.env.SUPPORT_REPLY_SECRET || "change-me-please";
  const inboxUrl  = `https://image-colour-remake-production.up.railway.app/support-reply/${opts.convId}?token=${encodeURIComponent(secret)}`;

  // Uses Cards v1 format — the only card format supported by incoming webhooks.
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cards: [{
        header: {
          title: opts.title,
          subtitle: opts.shopDomain,
          imageUrl: "https://fonts.gstatic.com/s/i/googlematerialicons/chat/v6/white-24dp/1x/gm_chat_white_24dp.png",
        },
        sections: [
          {
            widgets: [
              { keyValue: { topLabel: "Message", content: opts.content.slice(0, 1500), contentMultiline: "true" } },
              { keyValue: { topLabel: "Time", content: `${timestamp} AEST` } },
              {
                textParagraph: {
                  text: "<b>⚠️ Reply in the Support Inbox below — do NOT reply in Google Chat or the customer won't see it.</b>",
                },
              },
            ],
          },
          {
            widgets: [{
              buttons: [{
                textButton: {
                  text: "💬 Open Support Inbox & Reply",
                  onClick: { openLink: { url: inboxUrl } },
                },
              }],
            }],
          },
        ],
      }],
    }),
  }).catch((e) => console.error("Google Chat webhook error:", e));
}

// GET /api/support-chat — fetch or create conversation + all messages for this shop
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const conv = await prisma.supportConversation.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return Response.json(
    {
      conversation: conv
        ? {
            id: conv.id,
            status: conv.status,
            shopDomain: conv.shopDomain,
            // widget hides "Talk to a person" once a human is involved
            humanRequested: isHumanMode(conv, conv.messages),
          }
        : null,
      messages: conv?.messages ?? [],
      aiEnabled: supportAiEnabled(),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" } }
  );
}

// POST /api/support-chat
//   { body }              merchant sends a message
//   { action: "human" }   merchant asks for a person
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const payload = await request.json() as { body?: string; action?: string };

  // ── Merchant asked for a person ──────────────────────────────────────────
  if (payload.action === "human") {
    const conv = await prisma.supportConversation.findFirst({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
    });
    if (!conv) return Response.json({ error: "No conversation yet" }, { status: 400 });

    await prisma.supportConversation.update({
      where: { id: conv.id },
      data: { humanRequested: true, status: "open" },
    });

    const handoff = await prisma.supportMessage.create({
      data: { conversationId: conv.id, body: HANDOFF_REPLY, sender: "system" },
    });

    const recent = await prisma.supportMessage.findMany({
      where: { conversationId: conv.id, NOT: { id: handoff.id } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    const label = (s: string) => (s === "merchant" ? "Merchant" : s === "ai" ? "AI" : s === "support" ? "Team" : "Auto");
    const thread = recent.reverse().map((m) => `${label(m.sender)}: ${m.body}`).join("\n");

    notifyTeam({
      shopDomain: session.shop,
      convId:     conv.id,
      title:      "🙋 Merchant asked for a person",
      content:    thread || "(no earlier messages)",
    });

    return Response.json({ message: handoff, humanRequested: true });
  }

  // ── Merchant sent a message ──────────────────────────────────────────────
  const body = payload.body?.trim().slice(0, MAX_BODY);
  if (!body) return Response.json({ error: "Message is required" }, { status: 400 });

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
    data: { conversationId: conv.id, body, sender: "merchant" },
  });

  const history = await prisma.supportMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
  });
  const humanMode = isHumanMode(conv, history);

  // ── AI first line ─────────────────────────────────────────────────────────
  let aiMsg = null;
  if (!humanMode && supportAiEnabled()) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const aiToday = await prisma.supportMessage.count({
      where: { sender: "ai", createdAt: { gte: since }, conversation: { shopId: shop.id } },
    });

    if (aiToday < AI_DAILY_CAP) {
      const reply = await askSupportAI(history.map((m) => ({ sender: m.sender, body: m.body })));
      if (reply) {
        aiMsg = await prisma.supportMessage.create({
          data: { conversationId: conv.id, body: reply, sender: "ai" },
        });
        // Visible in Railway logs so you can see what merchants ask.
        console.log(`[support-ai] ${session.shop} Q: ${body.slice(0, 200)} | A: ${reply.slice(0, 200)}`);
      }
    }
  }

  // ── No AI answer: previous behaviour (auto-reply on first message + ping) ─
  let autoMsg = null;
  if (!aiMsg) {
    // Also acknowledge when the AI was meant to answer but could not (API
    // error, daily cap), so the merchant is never left with silence.
    if (isNewConversation || (!humanMode && supportAiEnabled())) {
      autoMsg = await prisma.supportMessage.create({
        data: { conversationId: conv.id, body: AUTO_REPLY, sender: "system" },
      });
    }
    notifyTeam({
      shopDomain: session.shop,
      convId:     conv.id,
      title:      "🛎️ New support message",
      content:    body,
    });
  }

  return Response.json({
    message: msg,
    autoReply: autoMsg,
    aiReply: aiMsg,
  });
}
