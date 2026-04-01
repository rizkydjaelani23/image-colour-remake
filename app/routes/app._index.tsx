import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { BillingInterval } from "@shopify/shopify-app-react-router/server";

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
  const { billing, session } = await authenticate.admin(request);

  await billing.require({
  plans: ["PRO_PLAN"],
  isTest: true,
  onFailure: async () =>
    billing.request({
      plan: "PRO_PLAN",
      isTest: true,
      trialDays: 3,
    }),
});

  const shop = await getOrCreateShop(session.shop);

  const usage = await prisma.shopUsage.findUnique({
    where: { shopId: shop.id },
  });

  const recentPreviewsRaw = await prisma.preview.findMany({
    where: {
      shopId: shop.id,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 6,
    include: {
      product: true,
    },
  });

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
  };
}

const pageStyle: CSSProperties = {
  padding: "24px",
  maxWidth: "1440px",
  margin: "0 auto",
  background: "#f8fafc",
  minHeight: "100vh",
};

const heroCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "24px",
  background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 55%, #eef2ff 100%)",
  padding: "28px",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.04)",
  marginBottom: "22px",
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "20px",
  background: "#ffffff",
  padding: "20px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
};

const statCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "18px",
  background: "#ffffff",
  padding: "18px",
  minHeight: "120px",
};

const buttonPrimaryStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 16px",
  borderRadius: "12px",
  background: "#111827",
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 700,
  border: "1px solid #111827",
};

const buttonSecondaryStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 16px",
  borderRadius: "12px",
  background: "#ffffff",
  color: "#111827",
  textDecoration: "none",
  fontWeight: 700,
  border: "1px solid #d1d5db",
};

function pillStyle(active: boolean, blue = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    border: active
      ? blue
        ? "1px solid #bfdbfe"
        : "1px solid #bbf7d0"
      : "1px solid #e5e7eb",
    background: active
      ? blue
        ? "#eff6ff"
        : "#f0fdf4"
      : "#f8fafc",
    color: active
      ? blue
        ? "#1d4ed8"
        : "#166534"
      : "#64748b",
  };
}

<div style={statCardStyle}>
  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "8px" }}>
    USAGE
  </div>
  <div style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
    {usage ? `${usage.previewCount} / ${usage.previewLimit}` : "0 / 50"}
  </div>
  <div style={{ fontSize: "14px", color: "#475569", lineHeight: 1.6 }}>
    Previews used this billing cycle.
  </div>
</div>

export default function Index() {
  const { recentPreviews, usage } = useLoaderData<typeof loader>();

  return (
    <div style={pageStyle}>
      <div style={heroCardStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.8fr) minmax(280px, 1fr)",
            gap: "18px",
            alignItems: "stretch",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: "#eef2ff",
                color: "#4338ca",
                fontSize: "12px",
                fontWeight: 700,
                marginBottom: "16px",
              }}
            >
              Product Visualiser Dashboard
            </div>

            <h1
              style={{
                margin: "0 0 12px 0",
                fontSize: "34px",
                lineHeight: 1.1,
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              Create, preview and manage realistic product colour variations
            </h1>

            <p
              style={{
                margin: "0 0 16px 0",
                fontSize: "15px",
                lineHeight: 1.7,
                color: "#475569",
                maxWidth: "780px",
              }}
            >
              This app helps you build product-specific upholstery zones, upload fabric
              swatches, generate preview images, and prepare customer-facing colour
              galleries for your Shopify storefront.
            </p>

            <div
              style={{
                padding: "14px 16px",
                borderRadius: "16px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                marginBottom: "18px",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#0f172a",
                  marginBottom: "6px",
                }}
              >
                Ongoing rendering improvements
              </div>
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: 1.6,
                  color: "#475569",
                }}
              >
                We are continuously updating the app to make colours more vibrant,
                accurate and realistic across different product types and materials.
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Link to="/app/visualiser" style={buttonPrimaryStyle}>
                Open Visualiser
              </Link>

              <Link to="/app/previews" style={buttonSecondaryStyle}>
                Open Preview Manager
              </Link>

              <Link to="/app/storefront-preview-test" style={buttonSecondaryStyle}>
                Test Storefront Layout
              </Link>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "20px",
              background: "#ffffff",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: "8px",
                }}
              >
                Quick Workflow
              </div>

              <div style={{ display: "grid", gap: "12px" }}>
                {[
                  "1. Select a Shopify product",
                  "2. Create or edit the product mask area",
                  "3. Save zones for repeat use",
                  "4. Upload swatches and generate previews",
                  "5. Approve previews for the storefront",
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "14px",
                      border: "1px solid #e5e7eb",
                      background: "#f8fafc",
                      fontSize: "14px",
                      color: "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "22px",
        }}
      >
        <div style={statCardStyle}>
          <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "8px" }}>
            MAIN TOOL
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
            Visualiser
          </div>
          <div style={{ fontSize: "14px", color: "#475569", lineHeight: 1.6 }}>
            Build and edit surface zones on the product image.
          </div>
        </div>

        <div style={statCardStyle}>
          <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "8px" }}>
            PREVIEWS
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
            Manager
          </div>
          <div style={{ fontSize: "14px", color: "#475569", lineHeight: 1.6 }}>
            Review and organise generated preview images.
          </div>
        </div>

        <div style={statCardStyle}>
          <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "8px" }}>
            STOREFRONT
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
            Gallery Test
          </div>
          <div style={{ fontSize: "14px", color: "#475569", lineHeight: 1.6 }}>
            Preview how approved colours will look to customers.
          </div>
        </div>

        <div style={statCardStyle}>
          <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "8px" }}>
            STATUS
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>
            In active development
          </div>
          <div style={{ fontSize: "14px", color: "#475569", lineHeight: 1.6 }}>
            Rendering, UI polish and storefront flow are being improved continuously.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 0.9fr)",
          gap: "16px",
        }}
      >
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 8px 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
            Recent generated previews
          </h2>
          <p style={{ margin: "0 0 18px 0", color: "#64748b", fontSize: "14px", lineHeight: 1.6 }}>
            Your latest generated previews appear here so you can quickly review recent work.
          </p>

          {recentPreviews.length === 0 ? (
            <div
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: "18px",
                padding: "26px",
                background: "#f8fafc",
              }}
            >
              <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
                No recent previews yet
              </div>
              <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6 }}>
                Generate previews in the Visualiser and they will appear here automatically.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "14px",
              }}
            >
              {recentPreviews.map((preview) => (
                <div
                  key={preview.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "16px",
                    overflow: "hidden",
                    background: "#ffffff",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "1 / 1",
                      background: "#f8fafc",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    <img
                      src={preview.imageUrl}
                      alt={preview.colourName}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  </div>

                  <div style={{ padding: "14px" }}>
                    <div
                      style={{
                        fontWeight: 700,
                        color: "#0f172a",
                        marginBottom: "6px",
                        fontSize: "14px",
                      }}
                    >
                      {preview.colourName}
                    </div>

                    <div
                      style={{
                        fontSize: "13px",
                        color: "#64748b",
                        lineHeight: 1.5,
                        marginBottom: "10px",
                      }}
                    >
                      {preview.productTitle || "Untitled product"}
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <span style={pillStyle(!!preview.approvedForStorefront)}>
                        {preview.approvedForStorefront ? "Approved" : "Draft"}
                      </span>

                      <span style={pillStyle(!!preview.featured, true)}>
                        {preview.featured ? "Featured" : preview.fabricFamily}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 8px 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
            Quick actions
          </h2>
          <p style={{ margin: "0 0 18px 0", color: "#64748b", fontSize: "14px", lineHeight: 1.6 }}>
            Jump straight into the next task.
          </p>

          <div style={{ display: "grid", gap: "12px" }}>
            <Link
              to="/app/visualiser"
              style={{
                ...buttonSecondaryStyle,
                justifyContent: "space-between",
              }}
            >
              <span>Start a new product mask</span>
              <span>→</span>
            </Link>

            <Link
              to="/app/previews"
              style={{
                ...buttonSecondaryStyle,
                justifyContent: "space-between",
              }}
            >
              <span>Manage generated previews</span>
              <span>→</span>
            </Link>

            <Link
              to="/app/storefront-preview-test"
              style={{
                ...buttonSecondaryStyle,
                justifyContent: "space-between",
              }}
            >
              <span>Check storefront presentation</span>
              <span>→</span>
            </Link>
          </div>

          <div
            style={{
              marginTop: "18px",
              padding: "16px",
              borderRadius: "16px",
              background: "#f8fafc",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
              Suggested next step
            </div>
            <div style={{ color: "#475569", fontSize: "14px", lineHeight: 1.6 }}>
              Select a product in the visualiser, confirm the mask area, then generate a
              small set of test previews before pushing anything to storefront view.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}