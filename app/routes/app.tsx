import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import en from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

const SUPPORT_EMAIL = "hello@poweryourhouse.io";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

function SupportButton() {
  const [open, setOpen]         = useState(false);
  const [message, setMessage]   = useState("");
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function sendMessage() {
    if (!message.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/support-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setSent(true);
      setMessage("");
      setTimeout(() => { setSent(false); setOpen(false); }, 3000);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  function openEmail() {
    const mailtoLink =
      `mailto:${SUPPORT_EMAIL}` +
      `?subject=${encodeURIComponent("Image Colour Remake – Support Request")}` +
      `&body=${encodeURIComponent("Hi,\n\nI need help with the following:\n\n[Please describe your issue here]\n\nThanks")}`;
    // Use window.top to escape the Shopify iframe — direct href is blocked inside embedded apps
    try { (window.top || window).location.href = mailtoLink; } catch { window.open(mailtoLink, "_blank"); }
  }

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSent(false); setSendError(null); }}
        title="Contact support"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9000,
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "22px",
          boxShadow: "0 4px 20px rgba(79,70,229,0.45)",
          transition: "transform 0.15s ease",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* Popover card */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "86px",
            right: "24px",
            zIndex: 9000,
            width: "300px",
            borderRadius: "20px",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            boxShadow: "0 16px 48px rgba(15,23,42,0.16)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", padding: "18px 20px" }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#ffffff", marginBottom: "4px" }}>
              💬 Chat with us
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
              Send us a message — we reply fast.
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "16px 18px" }}>
            {sent ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>✅</div>
                <div style={{ fontWeight: 700, color: "#111827", marginBottom: "4px" }}>Message sent!</div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>We'll get back to you shortly.</div>
              </div>
            ) : (
              <>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue or question…"
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #d1d5db",
                    font: "inherit",
                    fontSize: "13px",
                    resize: "none",
                    boxSizing: "border-box",
                    marginBottom: "10px",
                    outline: "none",
                  }}
                />

                {sendError && (
                  <div style={{ padding: "8px 10px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: "12px", marginBottom: "10px" }}>
                    {sendError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={sending || !message.trim()}
                  onClick={sendMessage}
                  style={{
                    width: "100%",
                    padding: "11px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: "14px",
                    border: "none",
                    cursor: sending || !message.trim() ? "not-allowed" : "pointer",
                    opacity: !message.trim() ? 0.5 : 1,
                    marginBottom: "10px",
                    font: "inherit",
                  }}
                >
                  {sending ? "Sending…" : "Send message"}
                </button>

                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>or</span>
                  <button
                    type="button"
                    onClick={openEmail}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#4f46e5", fontWeight: 600, padding: 0, font: "inherit" }}
                  >
                    ✉️ Email us instead
                  </button>
                </div>
              </>
            )}
          </div>
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
