import { useState, useEffect, useRef, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import en from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

const SUPPORT_EMAIL = "hello@poweryourhouse.io";

const FAQ_ITEMS = [
  {
    q: "How do I add colour previews to a product?",
    a: "Go to Visualiser → select your product → draw a zone over the fabric area → click a swatch to generate previews.",
  },
  {
    q: "Why isn't the gallery showing on my storefront?",
    a: "Make sure you've approved at least one colour in Preview Manager and toggled 'Show on storefront' ON for that product.",
  },
  {
    q: "Can I change the colour of an existing preview?",
    a: "Yes — open Preview Manager, find the preview, and click 'Regenerate'. Or go back to the Visualiser and re-run the swatch.",
  },
  {
    q: "What image formats can I upload for my own photo?",
    a: "JPG, PNG, and WebP are supported. Upload via Preview Manager → select product → Upload real photo.",
  },
  {
    q: "How many colours can I have per product?",
    a: "As many as you like — there's no cap on colours. Your plan controls how many AI generations you can run per month.",
  },
];

type ChatMessage = {
  id: string;
  body: string;
  sender: "merchant" | "support" | "system";
  createdAt: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function SupportButton() {
  const [open, setOpen]           = useState(false);
  const [view, setView]           = useState<"home" | "chat" | "faq">("home");
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [convId, setConvId]       = useState<string | null>(null);
  const [draft, setDraft]         = useState("");
  const [sending, setSending]     = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [openFaq, setOpenFaq]     = useState<number | null>(null);
  const messagesEndRef            = useRef<HTMLDivElement>(null);
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  function openEmail() {
    const link =
      `mailto:${SUPPORT_EMAIL}` +
      `?subject=${encodeURIComponent("Image Colour Remake – Support Request")}` +
      `&body=${encodeURIComponent("Hi,\n\nI need help with:\n\n")}`;
    try { (window.top || window).location.href = link; } catch { window.open(link, "_blank"); }
  }

  // Always bust the cache — without this, browsers return a stale GET response
  // and support replies never appear in the merchant's widget
  function chatUrl() {
    return `/api/support-chat?_t=${Date.now()}`;
  }

  const loadConversation = useCallback(async () => {
    setLoadError(null);
    try {
      const res  = await fetch(chatUrl());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConvId(data.conversation?.id ?? null);
      setMessages(data.messages ?? []);
      setHasLoaded(true);
    } catch {
      setLoadError("Couldn't load chat history.");
      setHasLoaded(true);
    }
  }, []);

  // Poll for new messages while chat is open
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(chatUrl());
        const data = await res.json();
        if (res.ok) {
          setConvId(data.conversation?.id ?? null);
          setMessages(data.messages ?? []);
        }
      } catch { /* silent */ }
    }, 3000); // 3s — snappy enough to feel live
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (open && view === "chat") {
      // Always reload when entering chat view — never serve stale state
      loadConversation();
      startPolling();
    } else {
      stopPolling();
      // Reset so next open does a fresh load
      if (!open) setHasLoaded(false);
    }
    return stopPolling;
  }, [open, view, loadConversation, startPolling, stopPolling]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res  = await fetch("/api/support-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft("");
      const newMsgs: ChatMessage[] = [data.message];
      if (data.autoReply) newMsgs.push(data.autoReply);
      setConvId(data.message?.conversationId ?? convId);
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...newMsgs.filter((m) => !ids.has(m.id))];
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function toggleOpen() {
    setOpen((v) => {
      if (!v) { setView("home"); setLoadError(null); }
      return !v;
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const S = {
    btn: (extra?: object): React.CSSProperties => ({
      border: "none", background: "none", cursor: "pointer", font: "inherit",
      padding: 0, display: "inline-flex", alignItems: "center", gap: "6px",
      ...extra,
    }),
    pill: (active?: boolean): React.CSSProperties => ({
      padding: "10px 14px", borderRadius: "12px", fontWeight: 700, fontSize: "13px",
      border: "1px solid #e5e7eb", background: active ? "#4f46e5" : "#f8fafc",
      color: active ? "#fff" : "#374151", cursor: "pointer", font: "inherit",
      width: "100%", textAlign: "left" as const, display: "flex",
      alignItems: "center", gap: "10px",
    }),
  };

  const bubble = (sender: string): React.CSSProperties => ({
    maxWidth: "82%",
    padding: "9px 13px",
    borderRadius: sender === "merchant" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
    fontSize: "13px",
    lineHeight: 1.5,
    background: sender === "merchant" ? "#4f46e5" : sender === "system" ? "#f0fdf4" : "#f1f5f9",
    color: sender === "merchant" ? "#fff" : sender === "system" ? "#166534" : "#111827",
    border: sender === "system" ? "1px solid #bbf7d0" : "none",
    alignSelf: sender === "merchant" ? "flex-end" : "flex-start",
    wordBreak: "break-word" as const,
  });

  return (
    <>
      {/* ── Floating button ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={toggleOpen}
        title="Chat with support"
        style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 9000,
          width: "54px", height: "54px", borderRadius: "50%",
          background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "24px", boxShadow: "0 4px 20px rgba(79,70,229,0.45)",
          transition: "transform 0.15s ease",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* ── Chat window ──────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: "fixed", bottom: "88px", right: "24px", zIndex: 9000,
          width: "320px", borderRadius: "20px", background: "#fff",
          border: "1px solid #e5e7eb",
          boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          maxHeight: "520px",
        }}>

          {/* Header */}
          <div style={{
            background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
            padding: "16px 18px", flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 800, color: "#fff" }}>🏠 Power Your House</div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
                  {view === "faq" ? "Frequently asked questions" : "Support · We reply within a few hours"}
                </div>
              </div>
              {view !== "home" && (
                <button type="button" onClick={() => setView("home")}
                  style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "8px",
                    padding: "5px 9px", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                  ← Back
                </button>
              )}
            </div>
          </div>

          {/* ── HOME view ── */}
          {view === "home" && (
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <button type="button" style={S.pill()} onClick={() => { setView("chat"); if (!hasLoaded) loadConversation(); }}>
                <span style={{ fontSize: "20px" }}>💬</span>
                <div>
                  <div style={{ fontWeight: 700 }}>Chat with us</div>
                  <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: 400 }}>Send a message, we'll reply here</div>
                </div>
              </button>
              <button type="button" style={S.pill()} onClick={() => setView("faq")}>
                <span style={{ fontSize: "20px" }}>❓</span>
                <div>
                  <div style={{ fontWeight: 700 }}>Common questions</div>
                  <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: 400 }}>Quick answers about the app</div>
                </div>
              </button>
              <button type="button" style={S.pill()} onClick={openEmail}>
                <span style={{ fontSize: "20px" }}>✉️</span>
                <div>
                  <div style={{ fontWeight: 700 }}>Email support</div>
                  <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: 400 }}>{SUPPORT_EMAIL}</div>
                </div>
              </button>
            </div>
          )}

          {/* ── FAQ view ── */}
          {view === "faq" && (
            <div style={{ overflowY: "auto", flex: 1 }}>
              {FAQ_ITEMS.map((item, i) => (
                <div key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    style={{
                      width: "100%", padding: "13px 16px", background: "none",
                      border: "none", cursor: "pointer", font: "inherit",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                      gap: "8px", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827", lineHeight: 1.4 }}>{item.q}</span>
                    <span style={{ color: "#94a3b8", flexShrink: 0, fontSize: "16px", lineHeight: 1 }}>{openFaq === i ? "−" : "+"}</span>
                  </button>
                  {openFaq === i && (
                    <div style={{ padding: "0 16px 14px", fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>
                      {item.a}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ padding: "14px 16px", borderTop: "1px solid #f1f5f9" }}>
                <button type="button" onClick={() => setView("chat")}
                  style={{ fontSize: "13px", color: "#4f46e5", fontWeight: 700, background: "none", border: "none", cursor: "pointer", font: "inherit", padding: 0 }}>
                  Still need help? Chat with us →
                </button>
              </div>
            </div>
          )}

          {/* ── CHAT view ── */}
          {view === "chat" && (
            <>
              {/* Message thread */}
              <div style={{
                flex: 1, overflowY: "auto", padding: "14px 14px 6px",
                display: "flex", flexDirection: "column", gap: "8px",
                minHeight: 0,
              }}>
                {!hasLoaded && (
                  <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "13px", paddingTop: "20px" }}>
                    Loading…
                  </div>
                )}
                {loadError && (
                  <div style={{ textAlign: "center", color: "#b91c1c", fontSize: "13px" }}>{loadError}</div>
                )}
                {hasLoaded && messages.length === 0 && (
                  <div style={{ textAlign: "center", padding: "24px 12px" }}>
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>👋</div>
                    <div style={{ fontWeight: 700, color: "#111827", marginBottom: "4px" }}>Hi there!</div>
                    <div style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.5 }}>
                      Send us a message and we'll get back to you as soon as possible.
                    </div>
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: m.sender === "merchant" ? "flex-end" : "flex-start",
                  }}>
                    {m.sender !== "merchant" && (
                      <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "3px", paddingLeft: "4px" }}>
                        {m.sender === "system" ? "Power Your House" : "Support Team"}
                      </div>
                    )}
                    <div style={bubble(m.sender)}>{m.body}</div>
                    <div style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "3px", paddingRight: m.sender === "merchant" ? "2px" : 0, paddingLeft: m.sender !== "merchant" ? "2px" : 0 }}>
                      {new Date(m.createdAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input bar */}
              <div style={{
                padding: "10px 12px", borderTop: "1px solid #f1f5f9",
                display: "flex", gap: "8px", alignItems: "flex-end", flexShrink: 0,
              }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Type a message…"
                  rows={1}
                  style={{
                    flex: 1, padding: "9px 12px", borderRadius: "12px",
                    border: "1px solid #d1d5db", font: "inherit", fontSize: "13px",
                    resize: "none", outline: "none", lineHeight: 1.5,
                    maxHeight: "80px", overflowY: "auto",
                  }}
                />
                <button
                  type="button"
                  disabled={sending || !draft.trim()}
                  onClick={sendMessage}
                  style={{
                    width: "36px", height: "36px", borderRadius: "10px", border: "none",
                    background: draft.trim() ? "#4f46e5" : "#e5e7eb",
                    color: "#fff", cursor: draft.trim() ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "16px", flexShrink: 0, transition: "background 0.15s",
                  }}
                >
                  {sending ? "…" : "↑"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/visualiser">Visualiser</s-link>
        <s-link href="/app/previews">Preview Manager</s-link>
        <s-link href="/app/swatches">Swatch Library</s-link>
        <s-link href="/app/storefront-preview-test">Storefront Preview</s-link>
        <s-link href="/app/instructions">Instructions</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/seo">SEO Engine</s-link>
        <s-link href="/app/support-inbox">Support Inbox</s-link>
      </s-app-nav>

      <Outlet />
      <SupportButton />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
