/**
 * Public support-reply page — no Shopify auth required.
 * Protected by a shared secret token (SUPPORT_REPLY_SECRET env var).
 * Linked from Google Chat notifications so support can reply from anywhere.
 *
 * URL: /support-reply/{convId}?token={SUPPORT_REPLY_SECRET}
 *
 * NOTE: The POST for sending replies goes to /api/support-reply-public
 * (a pure API route with no React component) instead of back to this page.
 * Posting to a page route with a React component causes React Router to
 * return the re-rendered HTML page instead of the action's JSON response.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../utils/db.server";

type Msg = { id: string; body: string; sender: string; createdAt: string };

type LoaderData =
  | { ok: true; convId: string; shopDomain: string; messages: Msg[]; token: string }
  | { ok: false; error: string };

type ApiResponse =
  | { ok: true; message: Msg }
  | { ok: false; error: string };

function getSecret() {
  return process.env.SUPPORT_REPLY_SECRET || "change-me-please";
}

export async function loader({ request, params }: LoaderFunctionArgs): Promise<Response> {
  const url    = new URL(request.url);
  const token  = url.searchParams.get("token") ?? "";
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

  return Response.json(
    {
      ok: true,
      convId: conv.id,
      shopDomain: conv.shopDomain,
      messages: conv.messages as unknown as Msg[],
      token,
    } satisfies LoaderData,
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export default function SupportReplyPage() {
  const loader = useLoaderData<typeof loader>() as LoaderData;

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

  return <ChatDashboard loader={loader as Extract<LoaderData, { ok: true }>} />;
}

function ChatDashboard({ loader }: { loader: Extract<LoaderData, { ok: true }> }) {
  const { convId, shopDomain, token } = loader;

  const [messages, setMessages] = useState<Msg[]>(loader.messages);
  const [draft, setDraft]       = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const messagesEndRef           = useRef<HTMLDivElement>(null);
  const textareaRef              = useRef<HTMLTextAreaElement>(null);
  // Ref-based send guard — prevents double-sends from rapid clicks / Enter key
  // before React's setState(true) has propagated to the next render.
  const isSendingRef             = useRef(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Poll for new messages every 3 s via a pure API route (no React component)
  // so we always get JSON back, never HTML.
  useEffect(() => {
    const poll = async () => {
      try {
        const res  = await fetch(
          `/api/support-messages-public?token=${encodeURIComponent(token)}&convId=${encodeURIComponent(convId)}&_t=${Date.now()}`
        );
        const data = await res.json() as { ok: boolean; messages?: Msg[] };
        if (data.ok && Array.isArray(data.messages)) {
          setMessages((prev) => {
            const confirmedCount = prev.filter((m) => !m.id.startsWith("opt-")).length;
            // Replace state with server truth when server has >= confirmed msgs
            if (data.messages!.length >= confirmedCount) return data.messages!;
            return prev;
          });
        }
      } catch { /* silent */ }
    };

    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [convId, token]);

  async function send() {
    const body = draft.trim();
    // Double-guard: state flag AND ref (ref wins because it's synchronous)
    if (!body || isSendingRef.current) return;

    isSendingRef.current = true;
    setSending(true);

    // Optimistic bubble
    const tempId  = `opt-${Date.now()}`;
    const tempMsg: Msg = { id: tempId, body, sender: "support", createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);
    setDraft("");
    setError(null);

    try {
      // POST to the pure API route — not back to this page route — so React
      // Router doesn't return HTML instead of JSON.
      const res  = await fetch("/api/support-reply-public", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token, conversationId: convId, body }),
      });
      const data = await res.json() as ApiResponse;

      if (!data.ok) {
        setError(data.error);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(body);
      } else {
        // Swap optimistic bubble for the real saved message
        setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error — please try again.";
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(body);
    } finally {
      isSendingRef.current = false;
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={styles.avatar}>🏠</div>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: "#fff" }}>Power Your House — Support</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", marginTop: "1px" }}>{shopDomain}</div>
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
          Live chat
        </div>
      </div>

      {/* Message thread */}
      <div style={styles.thread}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "13px", padding: "40px 0" }}>
            No messages yet in this conversation.
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} msg={m} />)}
        <div ref={messagesEndRef} />
      </div>

      {/* Error bar */}
      {error && (
        <div style={styles.errorBar}>
          ⚠️ {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700, marginLeft: "8px" }}
          >✕</button>
        </div>
      )}

      {/* Reply bar */}
      <div style={styles.replyBar}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your reply… (Enter to send, Shift+Enter for new line)"
          rows={2}
          style={styles.textarea}
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          style={{
            ...styles.sendBtn,
            background: canSend ? "#4f46e5" : "#e5e7eb",
            color:      canSend ? "#fff"    : "#9ca3af",
            cursor:     canSend ? "pointer" : "not-allowed",
          }}
        >
          {sending ? "…" : "↑"}
        </button>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isSupport    = msg.sender === "support";
  const isMerchant   = msg.sender === "merchant";
  const isSystem     = msg.sender === "system";
  const isOptimistic = msg.id.startsWith("opt-");

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isSupport ? "flex-end" : "flex-start",
      marginBottom: "14px",
    }}>
      <div style={{
        fontSize: "11px", color: "#94a3b8", marginBottom: "3px",
        paddingLeft:  !isSupport ? "4px" : 0,
        paddingRight:  isSupport ? "4px" : 0,
      }}>
        {isMerchant ? "🧑 Merchant" : isSystem ? "🤖 Auto-reply" : "🏠 You"}
      </div>
      <div style={{
        maxWidth: "72%",
        padding: "10px 14px",
        borderRadius: isSupport ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        background: isMerchant ? "#f1f5f9" : isSystem ? "#f0fdf4" : "#4f46e5",
        color:      isMerchant ? "#111827" : isSystem ? "#166534" : "#fff",
        border:     isSystem ? "1px solid #bbf7d0" : "none",
        fontSize: "14px", lineHeight: 1.5, wordBreak: "break-word",
        opacity: isOptimistic ? 0.7 : 1,
        transition: "opacity 0.2s",
      }}>
        {msg.body}
      </div>
      <div style={{
        fontSize: "10px", color: "#cbd5e1", marginTop: "3px",
        paddingLeft:  !isSupport ? "4px" : 0,
        paddingRight:  isSupport ? "4px" : 0,
      }}>
        {isOptimistic
          ? "Sending…"
          : new Date(msg.createdAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex", flexDirection: "column",
    height: "100dvh", background: "#f0f2f5",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    overflow: "hidden",
  },
  header: {
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    padding: "14px 20px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    flexShrink: 0,
    boxShadow: "0 2px 8px rgba(79,70,229,0.3)",
  },
  avatar: {
    width: "42px", height: "42px", borderRadius: "50%",
    background: "rgba(255,255,255,0.2)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "20px", flexShrink: 0,
  },
  thread: {
    flex: 1, overflowY: "auto",
    padding: "20px 16px",
    display: "flex", flexDirection: "column",
  },
  errorBar: {
    background: "#fef2f2", border: "1px solid #fecaca",
    color: "#b91c1c", fontSize: "13px",
    padding: "10px 16px",
    display: "flex", alignItems: "center", flexShrink: 0,
  },
  replyBar: {
    background: "#fff", borderTop: "1px solid #e5e7eb",
    padding: "12px 16px",
    display: "flex", gap: "10px", alignItems: "flex-end", flexShrink: 0,
  },
  textarea: {
    flex: 1, padding: "10px 14px",
    borderRadius: "24px", border: "1px solid #d1d5db",
    fontSize: "14px", fontFamily: "inherit",
    resize: "none", outline: "none", lineHeight: 1.5,
    background: "#f9fafb",
  },
  sendBtn: {
    width: "44px", height: "44px", borderRadius: "50%",
    border: "none", fontWeight: 700, fontSize: "18px",
    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.15s",
  },
  card: {
    background: "#fff", borderRadius: "16px",
    padding: "40px", textAlign: "center",
    border: "1px solid #e5e7eb",
    maxWidth: "400px", width: "100%", margin: "60px auto",
  },
};
