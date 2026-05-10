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
  const [open, setOpen] = useState(false);

  const mailtoLink =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent("Image Colour Remake – Support Request")}` +
    `&body=${encodeURIComponent(
      "Hi,\n\nI need help with the following:\n\n[Please describe your issue here]\n\nThanks"
    )}`;

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          <div
            style={{
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              padding: "18px 20px",
            }}
          >
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#ffffff", marginBottom: "4px" }}>
              Need help?
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
              Send us a message and we'll get back to you as soon as possible.
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "18px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "16px",
                padding: "10px 12px",
                borderRadius: "12px",
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "16px",
                  flexShrink: 0,
                }}
              >
                🏠
              </div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                  Power Your House
                </div>
                <div style={{ fontSize: "11px", color: "#64748b" }}>
                  {SUPPORT_EMAIL}
                </div>
              </div>
            </div>

            <a
              href={mailtoLink}
              style={{
                display: "block",
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                color: "#ffffff",
                textAlign: "center",
                fontWeight: 700,
                fontSize: "14px",
                textDecoration: "none",
                boxShadow: "0 4px 12px rgba(79,70,229,0.3)",
                boxSizing: "border-box",
              }}
              onClick={() => setOpen(false)}
            >
              ✉️ Send us an email
            </a>

            <div
              style={{
                marginTop: "12px",
                fontSize: "11px",
                color: "#94a3b8",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              We typically reply within 24 hours
            </div>
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
