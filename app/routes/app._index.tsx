import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { getCurrentBillingPlan } from "../utils/billing.server";
import { syncShopUsage } from "../utils/usage.server";

type RecentPreview = {
  id: string;
  colourName: string;
  fabricFamily: string;
  imageUrl: string;
  approvedForStorefront: boolean;
  featured: boolean;
  productTitle: string | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { planName, previewLimit } = await getCurrentBillingPlan(admin);
  const usage = await syncShopUsage({
    shopId: shop.id,
    previewLimit,
    resetExpiredCycle: true,
  });

  const [recentPreviewsRaw, totalProducts, totalApproved, totalPreviews] = await Promise.all([
    prisma.preview.findMany({
      where: { shopId: shop.id },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { product: true },
    }),
    prisma.product.count({
      where: { shopId: shop.id, previews: { some: {} } },
    }),
    prisma.preview.count({
      where: { shopId: shop.id, approvedForStorefront: true },
    }),
    prisma.preview.count({
      where: { shopId: shop.id },
    }),
  ]);

  const recentPreviews: RecentPreview[] = recentPreviewsRaw.map((preview) => ({
    id: preview.id,
    colourName: preview.colourName || "Untitled preview",
    fabricFamily: preview.fabricFamily || "Uncategorised",
    imageUrl: preview.imageUrl,
    approvedForStorefront: preview.approvedForStorefront,
    featured: preview.featured,
    productTitle: preview.product?.title || null,
  }));

  return {
    recentPreviews,
    usage,
    planName,
    totalProducts,
    totalApproved,
    totalPreviews,
  };
}

function pillStyle(active: boolean, blue = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    border: active
      ? blue ? "1px solid #bfdbfe" : "1px solid #bbf7d0"
      : "1px solid #e5e7eb",
    background: active
      ? blue ? "#eff6ff" : "#f0fdf4"
      : "#f8fafc",
    color: active
      ? blue ? "#1d4ed8" : "#166534"
      : "#64748b",
  };
}

export default function Index() {
  const { recentPreviews, usage, planName, totalProducts, totalApproved, totalPreviews } =
    useLoaderData<typeof loader>();

  const isPro = planName !== "Free";
  const usagePercent = isPro
    ? 100
    : Math.min(100, Math.round(((usage?.previewCount ?? 0) / (usage?.previewLimit ?? 50)) * 100));

  const hasAnyPreviews = totalPreviews > 0;
  const hasApproved = totalApproved > 0;
  const noneApproved = hasAnyPreviews && !hasApproved;

  return (
    <div style={{ padding: "24px", maxWidth: "1440px", margin: "0 auto", background: "#f8fafc", minHeight: "100vh" }}>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div
        style={{
          borderRadius: "24px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)",
          padding: "2px",
          marginBottom: "22px",
          boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
        }}
      >
        <div
          style={{
            borderRadius: "22px",
            padding: "32px",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.8fr) minmax(280px, 1fr)",
            gap: "24px",
            alignItems: "center",
          }}
        >
          {/* Left: headline + actions */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "5px 12px",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.1)",
                color: "#a5b4fc",
                fontSize: "12px",
                fontWeight: 700,
                marginBottom: "18px",
                letterSpacing: "0.04em",
              }}
            >
              ✦ Product Colour Visualiser
            </div>

            <h1
              style={{
                margin: "0 0 14px 0",
                fontSize: "36px",
                lineHeight: 1.08,
                fontWeight: 900,
                color: "#ffffff",
                letterSpacing: "-0.02em",
              }}
            >
              Create stunning colour previews — without a photo studio.
            </h1>

            <p
              style={{
                margin: "0 0 24px 0",
                fontSize: "15px",
                lineHeight: 1.7,
                color: "#94a3b8",
                maxWidth: "680px",
              }}
            >
              Upload fabric swatches, mark your product zones, and generate photorealistic colour
              previews in minutes. Let customers see every colour option before they buy.
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Link
                to="/app/visualiser"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 20px",
                  borderRadius: "12px",
                  background: "#ffffff",
                  color: "#0f172a",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: "14px",
                }}
              >
                Open Visualiser →
              </Link>

              <Link
                to="/app/previews"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 20px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.12)",
                  color: "#ffffff",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "14px",
                  border: "1px solid rgba(255,255,255,0.18)",
                }}
              >
                Preview Manager
              </Link>

              <Link
                to="/app/instructions"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 20px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.07)",
                  color: "#94a3b8",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "14px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                Instructions
              </Link>
            </div>
          </div>

          {/* Right: "How it works" mini-card */}
          <div
            style={{
              background: "rgba(255,255,255,0.06)",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "22px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#818cf8",
                marginBottom: "16px",
              }}
            >
              Quick start
            </div>

            {[
              { step: "1", label: "Select product", sub: "Pick any product from your store" },
              { step: "2", label: "Draw zone", sub: "Mark the fabric or upholstery area" },
              { step: "3", label: "Upload swatches", sub: "Single file or entire folder" },
              { step: "4", label: "Generate & approve", sub: "Previews go live on your store" },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    minWidth: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    background: "#4f46e5",
                    color: "#fff",
                    fontSize: "11px",
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: "1px",
                  }}
                >
                  {item.step}
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>{item.sub}</div>
                </div>
              </div>
            ))}

            <div
              style={{
                marginTop: "4px",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.25)",
                fontSize: "12px",
                color: "#a5b4fc",
                lineHeight: 1.5,
              }}
            >
              We continuously improve the rendering engine — previews get more accurate over time.
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "14px",
          marginBottom: "22px",
        }}
      >
        {/* Products configured */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "18px",
            background: "#ffffff",
            padding: "20px",
            borderTop: "4px solid #4f46e5",
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6366f1", marginBottom: "10px" }}>
            Products set up
          </div>
          <div style={{ fontSize: "36px", fontWeight: 900, color: "#0f172a", lineHeight: 1, marginBottom: "6px" }}>
            {totalProducts}
          </div>
          <div style={{ fontSize: "13px", color: "#64748b" }}>
            {totalProducts === 0
              ? "No products configured yet"
              : `${totalProducts} ${totalProducts === 1 ? "product has" : "products have"} zones saved`}
          </div>
        </div>

        {/* Previews generated */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "18px",
            background: "#ffffff",
            padding: "20px",
            borderTop: "4px solid #2563eb",
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#3b82f6", marginBottom: "10px" }}>
            Previews generated
          </div>
          <div style={{ fontSize: "36px", fontWeight: 900, color: "#0f172a", lineHeight: 1, marginBottom: "6px" }}>
            {isPro ? totalPreviews : `${usage?.previewCount ?? 0}`}
          </div>
          {!isPro && (
            <>
              <div
                style={{
                  height: "6px",
                  borderRadius: "99px",
                  background: "#e2e8f0",
                  overflow: "hidden",
                  margin: "8px 0",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${usagePercent}%`,
                    borderRadius: "99px",
                    background: usagePercent >= 90 ? "#ef4444" : usagePercent >= 70 ? "#f59e0b" : "#3b82f6",
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                {usage?.previewCount ?? 0} of {usage?.previewLimit ?? 50} this cycle
              </div>
            </>
          )}
          {isPro && (
            <div style={{ fontSize: "13px", color: "#64748b" }}>Unlimited on Pro plan</div>
          )}
        </div>

        {/* Approved & live */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "18px",
            background: "#ffffff",
            padding: "20px",
            borderTop: "4px solid #059669",
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#10b981", marginBottom: "10px" }}>
            Approved & live
          </div>
          <div style={{ fontSize: "36px", fontWeight: 900, color: "#0f172a", lineHeight: 1, marginBottom: "6px" }}>
            {totalApproved}
          </div>
          <div style={{ fontSize: "13px", color: "#64748b" }}>
            {totalApproved === 0
              ? "No previews approved yet"
              : `${totalApproved} ${totalApproved === 1 ? "preview" : "previews"} visible to customers`}
          </div>
        </div>

        {/* Plan */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "18px",
            background: "#ffffff",
            padding: "20px",
            borderTop: `4px solid ${isPro ? "#7c3aed" : "#94a3b8"}`,
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: isPro ? "#8b5cf6" : "#94a3b8", marginBottom: "10px" }}>
            Current plan
          </div>
          <div style={{ fontSize: "36px", fontWeight: 900, color: isPro ? "#6d28d9" : "#0f172a", lineHeight: 1, marginBottom: "6px" }}>
            {isPro ? planName : "Free"}
          </div>
          {isPro ? (
            <div style={{ fontSize: "13px", color: "#64748b" }}>Unlimited previews, all features</div>
          ) : (
            <div
              style={{
                marginTop: "8px",
                padding: "8px 10px",
                borderRadius: "10px",
                background: "#eef2ff",
                border: "1px solid #c7d2fe",
                fontSize: "12px",
                color: "#3730a3",
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              Upgrade to Pro ($29.99/mo) for unlimited previews
            </div>
          )}
        </div>
      </div>

      {/* ── Warning banner ── */}
      {noneApproved && (
        <div
          style={{
            marginBottom: "22px",
            padding: "16px 20px",
            borderRadius: "16px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: "#92400e", marginBottom: "4px" }}>
              None of your previews are approved for the storefront yet
            </div>
            <div style={{ fontSize: "13px", color: "#b45309", lineHeight: 1.5 }}>
              Customers won't see any colour options until at least one preview is approved.
            </div>
          </div>
          <Link
            to="/app/previews"
            style={{
              padding: "10px 16px",
              borderRadius: "10px",
              border: "1px solid #d97706",
              background: "#d97706",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "13px",
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Approve previews →
          </Link>
        </div>
      )}

      {/* ── Recent previews + Quick actions ────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 0.8fr)",
          gap: "16px",
        }}
      >
        {/* Recent previews */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "20px",
            background: "#ffffff",
            padding: "22px",
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>
                Recent previews
              </h2>
              <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "13px" }}>
                Your latest generated colour variations
              </p>
            </div>
            {recentPreviews.length > 0 && (
              <Link
                to="/app/previews"
                style={{ fontSize: "13px", color: "#4f46e5", fontWeight: 700, textDecoration: "none" }}
              >
                View all →
              </Link>
            )}
          </div>

          {recentPreviews.length === 0 ? (
            <div
              style={{
                border: "2px dashed #e2e8f0",
                borderRadius: "16px",
                padding: "32px",
                background: "#f8fafc",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🎨</div>
              <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
                No previews yet
              </div>
              <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6, marginBottom: "16px" }}>
                Open the Visualiser, select a product, and generate your first colour preview.
              </div>
              <Link
                to="/app/visualiser"
                style={{
                  display: "inline-flex",
                  padding: "10px 18px",
                  borderRadius: "10px",
                  background: "#0f172a",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "13px",
                }}
              >
                Open Visualiser →
              </Link>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: "14px",
              }}
            >
              {recentPreviews.map((preview) => (
                <div
                  key={preview.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "14px",
                    overflow: "hidden",
                    background: "#ffffff",
                    transition: "box-shadow 0.15s ease",
                  }}
                >
                  <div style={{ aspectRatio: "1 / 1", background: "#f8fafc" }}>
                    <img
                      src={preview.imageUrl}
                      alt={preview.colourName}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                  <div style={{ padding: "12px" }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "3px", fontSize: "13px" }}>
                      {preview.colourName}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preview.productTitle || "Untitled product"}
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <span style={pillStyle(!!preview.approvedForStorefront)}>
                        {preview.approvedForStorefront ? "✓ Live" : "Draft"}
                      </span>
                      <span style={pillStyle(!!preview.featured, true)}>
                        {preview.featured ? "★ Featured" : preview.fabricFamily}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Quick actions */}
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "20px",
              background: "#ffffff",
              padding: "22px",
              boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
            }}
          >
            <h2 style={{ margin: "0 0 4px 0", fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>
              Quick actions
            </h2>
            <p style={{ margin: "0 0 16px 0", color: "#64748b", fontSize: "13px" }}>
              Jump to the most common tasks.
            </p>

            <div style={{ display: "grid", gap: "8px" }}>
              {[
                { to: "/app/visualiser", label: "Set up a product", sub: "Select, mask, generate" },
                { to: "/app/previews", label: "Manage previews", sub: "Approve & organise" },
                { to: "/app/storefront-preview-test", label: "Test storefront gallery", sub: "See customer view" },
                { to: "/app/instructions", label: "View instructions", sub: "Setup guides & FAQ" },
              ].map((action) => (
                <Link
                  key={action.to}
                  to={action.to}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: "12px",
                    border: "1px solid #e5e7eb",
                    background: "#f8fafc",
                    textDecoration: "none",
                    gap: "8px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a" }}>
                      {action.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>{action.sub}</div>
                  </div>
                  <span style={{ color: "#cbd5e1", fontSize: "16px" }}>→</span>
                </Link>
              ))}
            </div>
          </div>

          {/* What's next suggestion */}
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "20px",
              background: "#ffffff",
              padding: "22px",
              boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "12px" }}>
              Suggested next step
            </div>
            {totalProducts === 0 ? (
              <>
                <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
                  Set up your first product
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.6 }}>
                  Open the Visualiser, select a product, and draw a mask over the fabric area.
                  Then upload a swatch and generate your first preview.
                </div>
              </>
            ) : noneApproved ? (
              <>
                <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
                  Approve your previews
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.6 }}>
                  You have generated previews but none are approved. Head to the Preview Manager
                  and approve the ones you want customers to see.
                </div>
              </>
            ) : totalApproved > 0 && (
              <>
                <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
                  Add the gallery block to your theme
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.6 }}>
                  You have approved previews ready. Go to Online Store → Themes → Customize and
                  add the Image Colour Remake app block to your product template.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
