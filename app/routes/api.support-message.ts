import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * POST /api/support-message
 * Forwards a support message from a merchant to Google Chat via an incoming webhook.
 * Set GOOGLE_CHAT_WEBHOOK_URL in Railway environment variables.
 * How to get it: Google Chat → open your space → Apps & integrations → Webhooks → Add webhook → copy URL.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const { message, shopDomain } = await request.json() as { message?: string; shopDomain?: string };

  if (!message?.trim()) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    // Fallback: still return OK so the UI confirms — just won't appear in Chat
    console.warn("GOOGLE_CHAT_WEBHOOK_URL not configured");
    return Response.json({ success: true, warn: "Webhook not configured" });
  }

  const shop = shopDomain || session.shop;
  const timestamp = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" });

  const chatText =
    `🛎️ *New support message*\n` +
    `*Shop:* ${shop}\n` +
    `*Time:* ${timestamp} AEST\n\n` +
    `${message.trim()}`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: chatText }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Google Chat webhook error:", res.status, body);
      return Response.json({ error: "Failed to send message" }, { status: 502 });
    }
  } catch (err) {
    console.error("Google Chat webhook fetch error:", err);
    return Response.json({ error: "Network error sending message" }, { status: 502 });
  }

  return Response.json({ success: true });
}
