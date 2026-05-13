/**
 * Public support-reply page — no Shopify auth required.
 * Protected by a shared secret token (SUPPORT_REPLY_SECRET env var).
 * Linked from Google Chat notifications so support can reply from anywhere.
 *
 * URL: /support-reply/{convId}?token={SUPPORT_REPLY_SECRET}
 */
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import prisma from "../utils/db.server";

type Msg = { id: string; body: string; sender: string; createdAt: string };

type LoaderData =
  | { ok: true; convId: string; shopDomain: string; messages: Msg[]; token: string }
  | { ok: false; error: string };

type ActionData =
  | { ok: true }
  | { ok: false; error: string };

function getSecret() {
  return process.env.SUPPORT_REPLY_SECRET || "change-me-please";
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<Response> {
  const url   = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const convId = params.convId ?? "";

  if (!token || token !== getSecret()) {
    return Response.json({ ok: false, error: "Invalid or missing token." } satisfies LoaderData, { status: 401 });
  }

  const conv = await prisma.supportConversation.findUnique({
    where: { id: convId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conv) {
    return Response.json({ ok: false, error: "Conversation not found." } satisfies LoaderData, { status: 404 });
  }

  return Response.json({
    ok: true,
    convId: conv.id,
    shopDomain: conv.shopDomain,
    messages: conv.messages as unknown as Msg[],
    token,
  } satisfies LoaderData);
}

export async function action({ request, params }: ActionFunctionArgs): Promise<Response> {
  const formData = await request.formData();
  const token    = (formData.get("token") as string) ?? "";
  const body     = ((formData.get("body") as string) ?? "").trim();
  const convId   = params.convId ?? "";

  if (!token || token !== getSecret()) {
    return Response.json({ ok: false, error: "Invalid token." } satisfies ActionData, { status: 401 });
  }

  if (!body) {
    return Response.json({ ok: false, error: "Reply cannot be empty." } satisfies ActionData, { status: 400 });
  }

  const conv = await prisma.supportConversation.findUnique({ where: { id: convId } });
  if (!conv) {
    return Response.json({ ok: false, error: "Conversation not found." } satisfies ActionData, { status: 404 });
  }

  await prisma.supportMessage.create({
    data: { conversationId: convId, body, sender: "support" },
  });

  await prisma.supportConversation.update({
    where: { id: convId },
    data: { updatedAt: new Date() },
  });

  return Response.json({ ok: true } satisfies ActionData);
}

export default function SupportReplyPage() {
  const loader  = useLoaderData<typeof loader>() as LoaderData;
  const action  = useActionData<typeof action>() as ActionData | undefined;
  const [draft, setDraft] = useState("");

  if (!loader.ok) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
          <h2 style={{ margin: "0 0 8px" }}>Access denied</h2>
          <p style={{ color: "#6b7280", margin: 0 }}>{loader.error}</p>
        </div>
      </div>
    );
  }

  if (action?.ok) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
          <h2 style={{ margin: "0 0 8px" }}>Reply sent!</h2>
          <p style={{ color: "#6b7280", margin: 0 }}>
            The merchant will see your reply in their chat widget within a few seconds.
          </p>
        </div>
      </div>
    );
  }

  const { shopDomain, messages, token, convId } = loader as Extract<LoaderData, { ok: true }>;

  return (
    <div style={styles.page}>
      <div style={{ maxWidth: "640px", width: "100%", margin: "0 auto", padding: "0 16px" }}>

        {/* Header */}
        <div style={styles.header}>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#fff" }}>🏠 Power Your House — Support Reply</div>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)", marginTop: "4px" }}>{shopDomain}</div>
        </div>

        {/* Message thread */}
        <div style={styles.thread}>
          {messages.map((m) => (
            <div key={m.id} style={{
              display: "flex",
              flexDirection: "column",
              alignItems: m.sender === "merchant" ? "flex-start" : "flex-end",
              marginBottom: "12px",
            }}>
              <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "3px" }}>
                {m.sender === "merchant" ? "🧑 Merchant" : m.sender === "system" ? "🤖 Auto-reply" : "🏠 You"}
              </div>
              <div style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: m.sender === "merchant" ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
                background: m.sender === "merchant" ? "#f1f5f9" : m.sender === "system" ? "#f0fdf4" : "#4f46e5",
                color: m.sender === "merchant" ? "#111827" : m.sender === "system" ? "#166534" : "#fff",
                border: m.sender === "system" ? "1px solid #bbf7d0" : "none",
                fontSize: "14px", lineHeight: 1.5, wordBreak: "break-word",
              }}>
                {m.body}
              </div>
              <div style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "3px" }}>
                {new Date(m.createdAt).toLocaleString("en-AU", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Reply form */}
        <Form method="post" onSubmit={() => setDraft("")}>
          <input type="hidden" name="token" value={token} />
          {action && !action.ok && (
            <div style={{ padding: "10px 14px", borderRadius: "10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: "13px", marginBottom: "12px" }}>
              {action.error}
            </div>
          )}
          <div style={styles.inputRow}>
            <textarea
              name="body"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your reply here…"
              rows={3}
              required
              style={styles.textarea}
            />
            <button type="submit" disabled={!draft.trim()} style={{
              ...styles.sendBtn,
              background: draft.trim() ? "#4f46e5" : "#e5e7eb",
              cursor: draft.trim() ? "pointer" : "not-allowed",
            }}>
              Send reply ↑
            </button>
          </div>
          <p style={{ fontSize: "12px", color: "#94a3b8", margin: "10px 0 0", textAlign: "center" }}>
            This reply will appear in the merchant's chat widget within a few seconds.
          </p>
        </Form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "0 0 40px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: "16px",
    padding: "40px",
    textAlign: "center" as const,
    border: "1px solid #e5e7eb",
    maxWidth: "400px",
    width: "100%",
    margin: "60px auto",
  },
  header: {
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    borderRadius: "0 0 20px 20px",
    padding: "24px 28px",
    marginBottom: "24px",
  },
  thread: {
    background: "#fff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    padding: "20px",
    marginBottom: "16px",
    maxHeight: "400px",
    overflowY: "auto" as const,
  },
  inputRow: {
    background: "#fff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    padding: "16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  },
  textarea: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #d1d5db",
    fontSize: "14px",
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    lineHeight: 1.5,
    boxSizing: "border-box" as const,
  },
  sendBtn: {
    padding: "12px",
    borderRadius: "10px",
    border: "none",
    color: "#fff",
    fontWeight: 700,
    fontSize: "15px",
    fontFamily: "inherit",
    transition: "background 0.15s",
  },
};
