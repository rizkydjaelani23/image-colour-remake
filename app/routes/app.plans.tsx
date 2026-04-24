import { useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  const shop = await getOrCreateShop(session.shop);

  let planName = "Free";
  let subscriptionId: string | null = null;

  try {
    const subscriptionResponse = await admin.graphql(`
      {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
          }
        }
      }
    `);

    const subscriptionData = await subscriptionResponse.json();
    const subs =
      subscriptionData?.data?.currentAppInstallation?.activeSubscriptions || [];

    const activeSub = subs.find(
      (s: { status: string }) => s.status === "ACTIVE",
    );

    if (activeSub) {
      planName = activeSub.name || "Pro";
      subscriptionId = activeSub.id;
    }
  } catch (err) {
    console.error("Failed to check subscription:", err);
  }

  const usage = await prisma.shopUsage.findUnique({
    where: { shopId: shop.id },
  });

  return {
    planName,
    subscriptionId,
    previewCount: usage?.previewCount ?? 0,
    previewLimit: usage?.previewLimit ?? 50,
    shopDomain: session.shop,
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
  const { planName, subscriptionId, previewCount, previewLimit, shopDomain } =
    useLoaderData<typeof loader>();

  const isPro = planName !== "Free";

  const [cancelling, setCancelling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error">("success");

  async function handleDowngrade() {
    if (
      !confirm(
        "Are you sure you want to downgrade to the Free plan? Your preview limit will be reduced to 50 per billing cycle.",
      )
    ) {
      return;
    }

    setCancelling(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok) {
        setStatusType("success");
        setStatusMessage(
          "Plan changed to Free. This page will refresh in a moment.",
        );
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setStatusType("error");
        setStatusMessage(data.error || "Failed to change plan.");
      }
    } catch {
      setStatusType("error");
      setStatusMessage("Something went wrong. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  function handleUpgrade() {
    // With Managed Pricing, upgrades are handled on the app's page in Shopify admin.
    // Open the app's admin page where Shopify shows plan options.
    const appSlug = "image-colour-remake-2";
    const upgradeUrl = `https://${shopDomain}/admin/apps/${appSlug}`;
    window.open(upgradeUrl, "_top");
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
          Choose the plan that fits your needs. Changes take effect immediately.
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
              disabled={cancelling}
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
                cursor: cancelling ? "not-allowed" : "pointer",
                opacity: cancelling ? 0.6 : 1,
                width: "100%",
              }}
            >
              {cancelling ? "Changing plan..." : "Downgrade to Free"}
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
                cursor: "pointer",
                width: "100%",
              }}
            >
              Upgrade to Pro
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
          Billing is managed by Shopify. When you upgrade, you'll be taken to
          Shopify's confirmation page where you can review and approve the
          charge. Downgrading cancels your current subscription immediately. All
          charges are prorated by Shopify — you only pay for what you use.
        </div>
      </div>
    </div>
  );
}
