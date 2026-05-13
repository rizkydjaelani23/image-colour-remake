import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";

type Msg = {
  id: string;
  body: string;
  sender: string;
  createdAt: string;
};

type Conv = {
  id: string;
  shopDomain: string;
  status: string;
  updatedAt: string;
  messages: Msg[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const conversations = await prisma.supportConversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return { conversations: conversations as unknown as Conv[] };
}

export default function SupportInboxPage() {
  const { conversations: initial } = useLoaderData<typeof loader>();
  const [conversations, setConversations] = useState<Conv[]>(initial);
  const [activeId, setActiveId]           = useState<string | null>(initial[0]?.id ?? null);
  const [drafts, setDrafts]               = useState<Record<string, string>>({});
  const [sending, setSending]             = useState<string | null>(null);
  const messagesEndRef                    = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // Poll for new messages every 3s — cache-busted so replies appear immediately
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res  = await fetch(`/api/support-conversations?_t=${Date.now()}`);
        const data = await res.json();
        if (res.ok) setConversations(data.conversations);
      } catch { /* silent */ }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length]);

  async function sendReply(convId: string) {
    const body = (drafts[convId] ?? "").trim();
    if (!body) return;
    setSending(convId);
    try {
      const res  = await fetch("/api/support-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDrafts((d) => ({ ...d, [convId]: "" }));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, data.message] }
            : c
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(null);
    }
  }

  async function closeConversation(convId: string) {
    try {
      await fetch("/api/support-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, action: "close" }),
      });
    } catch { /* ignore — optimistic update below */ }
    setConversations((prev) =>
      prev.map((c) => c.id === convId ? { ...c, status: "closed" } : c)
    );
  }

  const bubble = (sender: string): React.CSSProperties => ({
    maxWidth: "70%",
    padding: "10px 14px",
    borderRadius: sender === "merchant" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
    fontSize: "14px",
    lineHeight: 1.5,
    background: sender === "merchant" ? "#f1f5f9" : sender === "system" ? "#f0fdf4" : "#4f46e5",
    color: sender === "merchant" ? "#111827" : sender === "system" ? "#166534" : "#fff",
    border: sender === "system" ? "1px solid #bbf7d0" : "none",
    alignSelf: sender === "merchant" ? "flex-start" : "flex-end",
    wordBreak: "break-word" as const,
  });

  return (
    <div style={{ height: "calc(100vh - 56px)", display: "flex", fontFamily: "inherit" }}>

      {/* ── Sidebar: conversation list ── */}
      <div style={{
        width: "280px", flexShrink: 0, borderRight: "1px solid #e5e7eb",
        overflowY: "auto", background: "#f8fafc",
      }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#111827" }}>💬 Support Inbox</div>
          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
            {conversations.filter((c) => c.status === "open").length} open
          </div>
        </div>
        {conversations.length === 0 && (
          <div style={{ padding: "24px 16px", fontSize: "13px", color: "#94a3b8", textAlign: "center" }}>
            No conversations yet
          </div>
        )}
        {conversations.map((conv) => {
          const lastMsg = conv.messages[conv.messages.length - 1];
          const unread  = conv.messages.some((m) => m.sender === "merchant");
          const isActive = conv.id === activeId;
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => setActiveId(conv.id)}
              style={{
                width: "100%", padding: "12px 16px", border: "none", textAlign: "left",
                background: isActive ? "#eef2ff" : "#f8fafc",
                borderBottom: "1px solid #e5e7eb",
                cursor: "pointer", font: "inherit",
                borderLeft: isActive ? "3px solid #4f46e5" : "3px solid transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#111827", wordBreak: "break-all" }}>
                  {conv.shopDomain.replace(".myshopify.com", "")}
                </div>
                <span style={{
                  fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "999px",
                  background: conv.status === "open" ? "#dcfce7" : "#f1f5f9",
                  color: conv.status === "open" ? "#166534" : "#6b7280",
                }}>
                  {conv.status}
                </span>
              </div>
              {lastMsg && (
                <div style={{ fontSize: "11px", color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {lastMsg.sender === "merchant" ? "🧑 " : "🏠 "}{lastMsg.body}
                </div>
              )}
              <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>
                {new Date(conv.updatedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Main: message thread + reply ── */}
      {active ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

          {/* Conversation header */}
          <div style={{
            padding: "14px 20px", borderBottom: "1px solid #e5e7eb",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "#fff", flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 800, color: "#111827" }}>
                {active.shopDomain}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                {active.messages.length} message{active.messages.length !== 1 ? "s" : ""}
              </div>
            </div>
            {active.status === "open" && (
              <button
                type="button"
                onClick={() => closeConversation(active.id)}
                style={{
                  padding: "7px 14px", borderRadius: "10px", fontSize: "12px", fontWeight: 700,
                  border: "1px solid #d1d5db", background: "#fff", color: "#374151",
                  cursor: "pointer", font: "inherit",
                }}
              >
                ✓ Mark resolved
              </button>
            )}
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "20px",
            display: "flex", flexDirection: "column", gap: "10px",
            background: "#fafafa",
          }}>
            {active.messages.map((m) => (
              <div key={m.id} style={{
                display: "flex", flexDirection: "column",
                alignItems: m.sender === "merchant" ? "flex-start" : "flex-end",
              }}>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "3px",
                  paddingLeft: m.sender === "merchant" ? "4px" : 0,
                  paddingRight: m.sender !== "merchant" ? "4px" : 0,
                }}>
                  {m.sender === "merchant" ? "🧑 Merchant" : m.sender === "system" ? "🤖 Auto-reply" : "🏠 You"}
                </div>
                <div style={bubble(m.sender)}>{m.body}</div>
                <div style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "3px",
                  paddingLeft: m.sender === "merchant" ? "4px" : 0,
                  paddingRight: m.sender !== "merchant" ? "4px" : 0,
                }}>
                  {new Date(m.createdAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply bar */}
          <div style={{
            padding: "14px 20px", borderTop: "1px solid #e5e7eb",
            background: "#fff", display: "flex", gap: "10px", alignItems: "flex-end", flexShrink: 0,
          }}>
            <textarea
              value={drafts[active.id] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [active.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(active.id); }}}
              placeholder="Type your reply… (Enter to send, Shift+Enter for new line)"
              rows={2}
              style={{
                flex: 1, padding: "10px 14px", borderRadius: "12px",
                border: "1px solid #d1d5db", font: "inherit", fontSize: "14px",
                resize: "none", outline: "none", lineHeight: 1.5,
              }}
            />
            <button
              type="button"
              disabled={sending === active.id || !(drafts[active.id] ?? "").trim()}
              onClick={() => sendReply(active.id)}
              style={{
                padding: "10px 20px", borderRadius: "10px", border: "none",
                background: (drafts[active.id] ?? "").trim() ? "#4f46e5" : "#e5e7eb",
                color: "#fff", fontWeight: 700, fontSize: "14px",
                cursor: (drafts[active.id] ?? "").trim() ? "pointer" : "not-allowed",
                font: "inherit", flexShrink: 0,
              }}
            >
              {sending === active.id ? "Sending…" : "Send ↑"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "14px" }}>
          Select a conversation to view messages
        </div>
      )}
    </div>
  );
}
