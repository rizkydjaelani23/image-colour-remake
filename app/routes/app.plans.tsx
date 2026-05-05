import { useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../utils/shop.server";
import {
  getCurrentBillingPlan,
  getManagedPricingUrl,
} from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  const shop = await getOrCreateShop(session.shop);

  const { planName, previewLimit } = await getCurrentBillingPlan(admin);
  const usage = await syncShopUsage({
    shopId: shop.id,
    previewLimit,
    resetExpiredCycle: true,
  });

  return {
    planName,
    previewCount: usage?.previewCount ?? 0,
    previewLimit: usage?.previewLimit ?? 50,
    managedPricingUrl: getManagedPricingUrl(session.shop),
  };
}

const pageStyle: CSSProperties = {
  padding: "24px",
  maxWidth: "900px",
  margin: "0 auto",
  background: "#f8fafc",
  minHeight: "100vh",
};

export default function Plans() {
  const { planName, previewCount, previewLimit, managedPricingUrl } =
    useLoaderData<typeof loader>();

  const isPro = planName !== "Free";

  const [redirectingPlan, setRedirectingPlan] = useState<"free" | "pro" | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType] = useState<"success" | "error">("success");

  function openBilling(plan: "free" | "pro") {
    setRedirectingPlan(plan);
    setStatusMessage(
      "Opening Shopify billing so you can review the plan change.",
    );
    window.open(managedPricingUrl, "_top");
  }

  function handleDowngrade() {
    if (
      !confirm(
        "Open Shopify billing to change to the Free plan? Your preview limit will be reduced to 50 per billing cycle when Shopify completes the plan change.",
      )
    ) {
      return;
    }

    openBilling("free");
  }

  function handleUpgrade() {
    openBilling("pro");
  }

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "28px",
            fontWeight: 800,
            color: "#0f172a",
          }}
        >
          Your plan
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "15px",
            color: "#64748b",
            lineHeight: 1.6,
          }}
        >
          Choose the plan that fits your needs. Shopify will ask you to approve
          paid charges before they start.
        </p>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: "12px",
            marginBottom: "20px",
            background: statusType === "success" ? "#f0fdf4" : "#fef2f2",
            border:
              statusType === "success"
                ? "1px solid #bbf7d0"
                : "1px solid #fecaca",
            color: statusType === "success" ? "#166534" : "#991b1b",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Current usage summary */}
      <div
        style={{
          padding: "16px 20px",
          borderRadius: "16px",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "#64748b",
              marginBottom: "4px",
            }}
          >
            CURRENT PLAN
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 800,
              color: isPro ? "#166534" : "#0f172a",
            }}
          >
            {isPro ? planName : "Free"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "#64748b",
              marginBottom: "4px",
            }}
          >
            USAGE THIS CYCLE
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 800,
              color: "#0f172a",
            }}
          >
            {isPro
              ? `${previewCount} generated`
              : `${previewCount} / ${previewLimit}`}
          </div>
        </div>
      </div>

      {/* Plan cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px",
        }}
      >
        {/* Free plan */}
        <div
          style={{
            borderRadius: "20px",
            background: "#ffffff",
            border: !isPro ? "2px solid #111827" : "1px solid #e5e7eb",
            padding: "28px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {!isPro && (
            <div
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                padding: "4px 12px",
                borderRadius: "999px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                color: "#166534",
                fontSize: "12px",
                fontWeight: 700,
                marginBottom: "16px",
              }}
            >
              Current plan
            </div>
          )}

          <div
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: "#0f172a",
              marginBottom: "4px",
            }}
          >
            Free
          </div>

          <div style={{ marginBottom: "20px" }}>
            <span
              style={{
                fontSize: "36px",
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              $0
            </span>
            <span
              style={{
                fontSize: "15px",
                color: "#64748b",
                marginLeft: "4px",
              }}
            >
              /month
            </span>
          </div>

          <div
            style={{
              fontSize: "14px",
              color: "#475569",
              lineHeight: 1.6,
              marginBottom: "24px",
            }}
          >
            Get started with product colour visualisation. Perfect for testing
            the app with a small catalogue.
          </div>

          <div style={{ flex: 1 }}>
            {[
              "Up to 50 preview images per cycle",
              "Full mask editor with all tools",
              "Single and bulk preview generation",
              "Recently used colours",
              "Preview Manager",
              "Storefront gallery block",
            ].map((feature) => (
              <div
                key={feature}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginBottom: "12px",
                  fontSize: "14px",
                  color: "#0f172a",
                }}
              >
                <span
                  style={{
                    color: "#166534",
                    fontWeight: 700,
                    fontSize: "16px",
                    lineHeight: 1,
                    marginTop: "2px",
                  }}
                >
                  {"\u2713"}
                </span>
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {!isPro ? (
            <div
              style={{
                marginTop: "20px",
                padding: "12px 16px",
                borderRadius: "12px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: "#166534",
              }}
            >
              {"\u2713"} Active
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDowngrade}
              disabled={redirectingPlan === "free"}
              style={{
                marginTop: "20px",
                padding: "12px 16px",
                borderRadius: "12px",
                background: "#ffffff",
                border: "1px solid #d1d5db",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: "#111827",
                cursor: redirectingPlan === "free" ? "not-allowed" : "pointer",
                opacity: redirectingPlan === "free" ? 0.6 : 1,
                width: "100%",
              }}
            >
              {redirectingPlan === "free"
                ? "Opening Shopify billing..."
                : "Downgrade to Free"}
            </button>
          )}
        </div>

        {/* Pro plan */}
        <div
          style={{
            borderRadius: "20px",
            background: isPro
              ? "#ffffff"
              : "linear-gradient(135deg, #ffffff 0%, #f8fafc 60%, #eef2ff 100%)",
            border: isPro ? "2px solid #111827" : "1px solid #c7d2fe",
            padding: "28px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isPro ? (
            <div
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                padding: "4px 12px",
                borderRadius: "999px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                color: "#166534",
                fontSize: "12px",
                fontWeight: 700,
                marginBottom: "16px",
              }}
            >
              Current plan
            </div>
          ) : (
            <div
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                padding: "4px 12px",
                borderRadius: "999px",
                background: "#eef2ff",
                border: "1px solid #c7d2fe",
                color: "#4338ca",
                fontSize: "12px",
                fontWeight: 700,
                marginBottom: "16px",
              }}
            >
              Recommended
            </div>
          )}

          <div
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: "#0f172a",
              marginBottom: "4px",
            }}
          >
            Pro
          </div>

          <div style={{ marginBottom: "20px" }}>
            <span
              style={{
                fontSize: "36px",
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              $29.99
            </span>
            <span
              style={{
                fontSize: "15px",
                color: "#64748b",
                marginLeft: "4px",
              }}
            >
              /month
            </span>
          </div>

          <div
            style={{
              fontSize: "14px",
              color: "#475569",
              lineHeight: 1.6,
              marginBottom: "24px",
            }}
          >
            Unlimited previews for merchants with large catalogues or frequent
            colour updates. No limits, no interruptions.
          </div>

          <div style={{ flex: 1 }}>
            {[
              "Unlimited preview images",
              "Everything in Free, plus:",
              "No usage limits or throttling",
              "Priority rendering",
              "Full bulk generation support",
              "Ideal for large catalogues",
            ].map((feature, i) => (
              <div
                key={feature}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginBottom: "12px",
                  fontSize: "14px",
                  color: i === 1 ? "#64748b" : "#0f172a",
                  fontWeight: i === 0 ? 700 : 400,
                }}
              >
                {i === 1 ? (
                  <span style={{ width: "16px" }} />
                ) : (
                  <span
                    style={{
                      color: "#4338ca",
                      fontWeight: 700,
                      fontSize: "16px",
                      lineHeight: 1,
                      marginTop: "2px",
                    }}
                  >
                    {"\u2713"}
                  </span>
                )}
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {isPro ? (
            <div
              style={{
                marginTop: "20px",
                padding: "12px 16px",
                borderRadius: "12px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: "#166534",
              }}
            >
              {"\u2713"} Active
            </div>
          ) : (
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={redirectingPlan === "pro"}
              style={{
                marginTop: "20px",
                padding: "14px 16px",
                borderRadius: "12px",
                background: "#111827",
                border: "1px solid #111827",
                color: "#ffffff",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 700,
                cursor: redirectingPlan === "pro" ? "not-allowed" : "pointer",
                opacity: redirectingPlan === "pro" ? 0.7 : 1,
                width: "100%",
              }}
            >
              {redirectingPlan === "pro"
                ? "Opening Shopify billing..."
                : "Upgrade to Pro"}
            </button>
          )}
        </div>
      </div>

      {/* How to change plans */}
      <div
        style={{
          marginTop: "24px",
          padding: "20px",
          borderRadius: "16px",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            fontSize: "15px",
            fontWeight: 700,
            color: "#0f172a",
            marginBottom: "8px",
          }}
        >
          How billing works
        </div>
        <div
          style={{
            fontSize: "14px",
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          Billing is managed by Shopify. When you change plans, you'll be taken
          to Shopify's hosted plan selection page where you can review,
          approve, or decline plan charges. Shopify handles proration, test
          subscriptions for development stores, and approval if the app is
          reinstalled.
        </div>
      </div>
    </div>
  );
}
