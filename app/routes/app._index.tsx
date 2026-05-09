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
    <div style={{ padding: "24px", maxWidth: "1440px", margin: "0 auto", background: "#f1f5f9", minHeight: "100vh" }}>

      {/* ── Hero ────────────────────────────────────────────────────────────────── */}
      <div style={{
        borderRadius: "24px",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 58%, #312e81 100%)",
        marginBottom: "20px",
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 24px 64px rgba(15,23,42,0.22), 0 4px 20px rgba(79,70,229,0.18)",
      }}>
        {/* Dot grid overlay */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)",
          backgroundSize: "28px 28px",
          pointerEvents: "none",
        }} />
        {/* Glow blob */}
        <div style={{
          position: "absolute",
          top: "-80px",
          right: "180px",
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{
          position: "relative",
          padding: "36px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.8fr) minmax(260px, 1fr)",
          gap: "32px",
          alignItems: "center",
        }}>
          {/* Left: headline + CTAs */}
          <div>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "5px 14px",
              borderRadius: "999px",
              background: "rgba(99,102,241,0.2)",
              border: "1px solid rgba(99,102,241,0.35)",
              color: "#a5b4fc",
              fontSize: "11px",
              fontWeight: 800,
              marginBottom: "20px",
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
            }}>
              ✦ Product Colour Visualiser
            </div>

            <h1 style={{
              margin: "0 0 16px 0",
              fontSize: "38px",
              lineHeight: 1.07,
              fontWeight: 900,
              color: "#ffffff",
              letterSpacing: "-0.025em",
            }}>
              Create stunning<br />
              colour previews —<br />
              <span style={{ color: "#818cf8" }}>without a photo studio.</span>
            </h1>

            <p style={{
              margin: "0 0 28px 0",
              fontSize: "15px",
              lineHeight: 1.75,
              color: "#94a3b8",
              maxWidth: "540px",
            }}>
              Upload fabric swatches, mark your product zones, and generate photorealistic colour
              previews in minutes. Let customers see every colour before they buy.
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Link to="/app/visualiser" style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "13px 22px",
                borderRadius: "12px",
                background: "#ffffff",
                color: "#0f172a",
                textDecoration: "none",
                fontWeight: 800,
                fontSize: "14px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.22)",
              }}>
                🎨 Open Visualiser
              </Link>
              <Link to="/app/previews" style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "13px 22px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.1)",
                color: "#e2e8f0",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "14px",
                border: "1px solid rgba(255,255,255,0.15)",
              }}>
                Preview Manager
              </Link>
              <Link to="/app/instructions" style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "13px 22px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.05)",
                color: "#64748b",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "14px",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
                Instructions
              </Link>
            </div>
          </div>

          {/* Right: How it works */}
          <div style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: "20px",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "24px",
          }}>
            <div style={{
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              color: "#6366f1",
              marginBottom: "18px",
            }}>
              How it works
            </div>

            {[
              { icon: "🛋️", label: "Select product", sub: "Pick any product from your store" },
              { icon: "✏️", label: "Draw zone", sub: "Mark the fabric or upholstery area" },
              { icon: "🧵", label: "Upload swatches", sub: "Single file or entire folder" },
              { icon: "✅", label: "Generate & approve", sub: "Previews go live on your store" },
            ].map((item, i) => (
              <div key={item.label} style={{
                display: "flex",
                gap: "14px",
                alignItems: "flex-start",
                marginBottom: i < 3 ? "14px" : 0,
              }}>
                <div style={{
                  minWidth: "38px",
                  height: "38px",
                  borderRadius: "10px",
                  background: "rgba(79,70,229,0.22)",
                  border: "1px solid rgba(99,102,241,0.28)",
                  fontSize: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {item.icon}
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0", marginBottom: "2px" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.4 }}>
                    {item.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Warning banner ──────────────────────────────────────────────────────── */}
      {noneApproved && (
        <div style={{
          marginBottom: "20px",
          padding: "16px 20px",
          borderRadius: "16px",
          background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
          border: "1px solid #fde68a",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          boxShadow: "0 2px 12px rgba(251,191,36,0.14)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ fontSize: "26px" }}>⚠️</div>
            <div>
              <div style={{ fontWeight: 700, color: "#92400e", marginBottom: "3px" }}>
                None of your previews are approved yet
              </div>
              <div style={{ fontSize: "13px", color: "#b45309", lineHeight: 1.5 }}>
                Customers won't see colour options until at least one preview is approved.
              </div>
            </div>
          </div>
          <Link to="/app/previews" style={{
            padding: "10px 18px",
            borderRadius: "10px",
            background: "#d97706",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "13px",
            textDecoration: "none",
            whiteSpace: "nowrap",
            flexShrink: 0,
            boxShadow: "0 4px 12px rgba(217,119,6,0.3)",
          }}>
            Approve previews →
          </Link>
        </div>
      )}

      {/* ── Stats row ───────────────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: "14px",
        marginBottom: "20px",
      }}>
        {/* Products */}
        <div style={{
          borderRadius: "20px",
          background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
          border: "1px solid #c7d2fe",
          padding: "22px",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(79,70,229,0.08)",
        }}>
          <div style={{ position: "absolute", right: "18px", top: "16px", fontSize: "32px", opacity: 0.18 }}>📦</div>
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#4f46e5", marginBottom: "10px" }}>
            Products set up
          </div>
          <div style={{ fontSize: "44px", fontWeight: 900, color: "#1e1b4b", lineHeight: 1, marginBottom: "6px" }}>
            {totalProducts}
          </div>
          <div style={{ fontSize: "13px", color: "#4338ca", opacity: 0.8 }}>
            {totalProducts === 0
              ? "No products configured yet"
              : `${totalProducts} ${totalProducts === 1 ? "product has" : "products have"} zones saved`}
          </div>
        </div>

        {/* Previews generated */}
        <div style={{
          borderRadius: "20px",
          background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
          border: "1px solid #bfdbfe",
          padding: "22px",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(37,99,235,0.08)",
        }}>
          <div style={{ position: "absolute", right: "18px", top: "16px", fontSize: "32px", opacity: 0.18 }}>🎨</div>
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#2563eb", marginBottom: "10px" }}>
            Previews generated
          </div>
          <div style={{ fontSize: "44px", fontWeight: 900, color: "#1e3a8a", lineHeight: 1, marginBottom: "6px" }}>
            {isPro ? totalPreviews : (usage?.previewCount ?? 0)}
          </div>
          {!isPro && (
            <>
              <div style={{
                height: "5px",
                borderRadius: "99px",
                background: "rgba(37,99,235,0.15)",
                overflow: "hidden",
                margin: "8px 0 6px",
              }}>
                <div style={{
                  height: "100%",
                  width: `${usagePercent}%`,
                  borderRadius: "99px",
                  background: usagePercent >= 90 ? "#ef4444" : usagePercent >= 70 ? "#f59e0b" : "#2563eb",
                }} />
              </div>
              <div style={{ fontSize: "12px", color: "#1d4ed8", opacity: 0.75 }}>
                {usage?.previewCount ?? 0} of {usage?.previewLimit ?? 50} this cycle
              </div>
            </>
          )}
          {isPro && (
            <div style={{ fontSize: "13px", color: "#1d4ed8", opacity: 0.75 }}>Unlimited on Pro plan</div>
          )}
        </div>

        {/* Approved & live */}
        <div style={{
          borderRadius: "20px",
          background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
          border: "1px solid #bbf7d0",
          padding: "22px",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(5,150,105,0.08)",
        }}>
          <div style={{ position: "absolute", right: "18px", top: "16px", fontSize: "32px", opacity: 0.18 }}>✅</div>
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#059669", marginBottom: "10px" }}>
            Approved & live
          </div>
          <div style={{ fontSize: "44px", fontWeight: 900, color: "#14532d", lineHeight: 1, marginBottom: "6px" }}>
            {totalApproved}
          </div>
          <div style={{ fontSize: "13px", color: "#16a34a", opacity: 0.8 }}>
            {totalApproved === 0
              ? "None visible to customers yet"
              : `${totalApproved} ${totalApproved === 1 ? "preview" : "previews"} visible to customers`}
          </div>
        </div>

        {/* Plan */}
        <div style={{
          borderRadius: "20px",
          background: isPro
            ? "linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)"
            : "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          border: isPro ? "1px solid #d8b4fe" : "1px solid #e2e8f0",
          padding: "22px",
          position: "relative",
          overflow: "hidden",
          boxShadow: isPro ? "0 2px 12px rgba(124,58,237,0.1)" : "0 2px 8px rgba(0,0,0,0.04)",
        }}>
          <div style={{ position: "absolute", right: "18px", top: "16px", fontSize: "32px", opacity: 0.18 }}>
            {isPro ? "⭐" : "🆓"}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: isPro ? "#7c3aed" : "#94a3b8", marginBottom: "10px" }}>
            Current plan
          </div>
          <div style={{ fontSize: "44px", fontWeight: 900, color: isPro ? "#4c1d95" : "#0f172a", lineHeight: 1, marginBottom: "8px" }}>
            {isPro ? planName : "Free"}
          </div>
          {isPro ? (
            <div style={{ fontSize: "13px", color: "#7c3aed", opacity: 0.8 }}>Unlimited previews, all features</div>
          ) : (
            <Link to="/app/plans" style={{
              display: "inline-flex",
              padding: "7px 14px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #6366f1, #7c3aed)",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
            }}>
              Upgrade to Pro →
            </Link>
          )}
        </div>
      </div>

      {/* ── Bottom: Recent previews + sidebar ──────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.5fr) minmax(300px, 0.7fr)",
        gap: "16px",
      }}>
        {/* Recent previews */}
        <div style={{
          borderRadius: "20px",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          padding: "24px",
          boxShadow: "0 2px 12px rgba(15,23,42,0.05)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#0f172a" }}>
                Recent previews
              </h2>
              <p style={{ margin: "3px 0 0", color: "#94a3b8", fontSize: "13px" }}>
                Your latest generated colour variations
              </p>
            </div>
            {recentPreviews.length > 0 && (
              <Link to="/app/previews" style={{ fontSize: "13px", color: "#4f46e5", fontWeight: 700, textDecoration: "none" }}>
                View all →
              </Link>
            )}
          </div>

          {recentPreviews.length === 0 ? (
            <div style={{
              border: "2px dashed #e2e8f0",
              borderRadius: "16px",
              padding: "48px 32px",
              textAlign: "center",
              background: "#f8fafc",
            }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>🎨</div>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "8px", fontSize: "16px" }}>
                No previews yet
              </div>
              <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6, marginBottom: "20px", maxWidth: "320px", margin: "0 auto 20px" }}>
                Open the Visualiser, select a product, and generate your first colour preview.
              </div>
              <Link to="/app/visualiser" style={{
                display: "inline-flex",
                padding: "12px 22px",
                borderRadius: "10px",
                background: "#0f172a",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "14px",
                boxShadow: "0 4px 14px rgba(15,23,42,0.22)",
              }}>
                Open Visualiser →
              </Link>
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "12px",
            }}>
              {recentPreviews.map((preview) => (
                <div key={preview.id} style={{
                  borderRadius: "14px",
                  overflow: "hidden",
                  background: "#ffffff",
                  border: "1px solid #f1f5f9",
                  boxShadow: "0 2px 8px rgba(15,23,42,0.07)",
                }}>
                  <div style={{ aspectRatio: "1 / 1", background: "#f8fafc", position: "relative" }}>
                    <img
                      src={preview.imageUrl}
                      alt={preview.colourName}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    {/* Live / Draft dot */}
                    <div style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: preview.approvedForStorefront ? "#22c55e" : "#94a3b8",
                      border: "2px solid white",
                      boxShadow: preview.approvedForStorefront ? "0 0 0 3px rgba(34,197,94,0.22)" : "none",
                    }} />
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "12px", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preview.colourName}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "8px" }}>
                      {preview.productTitle || "Untitled product"}
                    </div>
                    <div style={{
                      fontSize: "10px",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase" as const,
                      color: preview.approvedForStorefront ? "#16a34a" : "#94a3b8",
                    }}>
                      {preview.approvedForStorefront ? "● Live" : "○ Draft"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Quick actions */}
          <div style={{
            borderRadius: "20px",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            padding: "22px",
            boxShadow: "0 2px 12px rgba(15,23,42,0.05)",
          }}>
            <h2 style={{ margin: "0 0 4px 0", fontSize: "17px", fontWeight: 800, color: "#0f172a" }}>
              Quick actions
            </h2>
            <p style={{ margin: "0 0 14px 0", color: "#94a3b8", fontSize: "13px" }}>
              Jump to the most common tasks
            </p>

            <div style={{ display: "grid", gap: "8px" }}>
              {[
                { to: "/app/visualiser", icon: "🎨", label: "Set up a product", sub: "Select, mask, generate", color: "#4f46e5" },
                { to: "/app/previews",   icon: "📋", label: "Manage previews",  sub: "Approve & organise",    color: "#2563eb" },
                { to: "/app/swatches",   icon: "🧵", label: "Swatch library",   sub: "Browse & clean up",     color: "#059669" },
                { to: "/app/instructions", icon: "📖", label: "Instructions",  sub: "Setup guides & FAQ",    color: "#7c3aed" },
              ].map((action) => (
                <Link
                  key={action.to}
                  to={action.to}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "11px 14px",
                    borderRadius: "12px",
                    border: "1px solid #f1f5f9",
                    background: "#f8fafc",
                    textDecoration: "none",
                  }}
                >
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: `${action.color}14`,
                    border: `1px solid ${action.color}28`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                    flexShrink: 0,
                  }}>
                    {action.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a" }}>
                      {action.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>{action.sub}</div>
                  </div>
                  <span style={{ color: "#cbd5e1", fontSize: "14px", flexShrink: 0 }}>→</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Suggested next step */}
          <div style={{
            borderRadius: "20px",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderLeft: "4px solid #4f46e5",
            padding: "22px",
            boxShadow: "0 2px 12px rgba(15,23,42,0.05)",
          }}>
            <div style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#6366f1", marginBottom: "12px" }}>
              ▶ Suggested next step
            </div>

            {totalProducts === 0 ? (
              <>
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "8px", fontSize: "15px" }}>
                  Set up your first product
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.65 }}>
                  Open the Visualiser, pick a product, and draw a mask over the fabric area. Then upload a swatch to generate your first preview.
                </div>
              </>
            ) : noneApproved ? (
              <>
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "8px", fontSize: "15px" }}>
                  Approve your previews
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.65 }}>
                  You have previews but none are approved. Go to the Preview Manager and approve the ones ready for customers to see.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "8px", fontSize: "15px" }}>
                  Add the gallery to your theme
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.65 }}>
                  Go to Online Store → Themes → Customize and add the Image Colour Remake block to your product page template.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
