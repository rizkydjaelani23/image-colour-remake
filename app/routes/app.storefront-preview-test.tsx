import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../utils/shop.server";
import prisma from "../utils/db.server";

const CARD_THRESHOLD = 6; // show cards up to this many; dropdown above it

type ProductSummary = {
  shopifyProductId: string;
  title: string | null;
  imageUrl: string | null;
  approvedCount: number;
};

type StorefrontPreview = {
  id: string;
  fabricFamily: string;
  colourName: string;
  imageUrl: string;
  featured: boolean;
  status: string;
};

type ProductInfo = {
  id: string;
  shopifyProductId: string;
  title: string | null;
  handle: string | null;
  imageUrl: string | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const raw = await prisma.product.findMany({
    where: {
      shopId: shop.id,
      previews: { some: { approvedForStorefront: true } },
    },
    select: {
      shopifyProductId: true,
      title: true,
      imageUrl: true,
      _count: {
        select: { previews: { where: { approvedForStorefront: true } } },
      },
    },
    orderBy: { title: "asc" },
  });

  return {
    shopDomain: session.shop,
    products: raw.map((p) => ({
      shopifyProductId: p.shopifyProductId,
      title: p.title,
      imageUrl: p.imageUrl ?? null,
      approvedCount: p._count.previews,
    })) satisfies ProductSummary[],
  };
}

export default function StorefrontPreviewTestPage() {
  const { shopDomain, products } = useLoaderData<typeof loader>();

  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    products.length === 1 ? products[0].shopifyProductId : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [previews, setPreviews] = useState<StorefrontPreview[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<StorefrontPreview | null>(null);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const [showOriginalImage, setShowOriginalImage] = useState(false);

  // Auto-load if only one product
  useMemo(() => {
    if (products.length === 1) {
      loadStorefrontPreviews(products[0].shopifyProductId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStorefrontPreviews(productId: string) {
    setSelectedProductId(productId);
    setLoading(true);
    setError(null);
    setProduct(null);
    setPreviews([]);
    setSelectedPreview(null);
    setActiveFamily(null);
    setShowOriginalImage(false);

    try {
      const response = await fetch(
        `/api/storefront-previews?shop=${encodeURIComponent(shopDomain)}&productId=${encodeURIComponent(productId)}`
      );

      const rawText = await response.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(rawText || "Server did not return valid JSON");
      }

      if (!response.ok) throw new Error(data.error || "Failed to load storefront previews");

      const nextProduct = data.product || null;
      const nextPreviews: StorefrontPreview[] = data.previews || [];
      const featured = nextPreviews.find((p) => p.featured) || nextPreviews[0] || null;

      setProduct(nextProduct);
      setPreviews(nextPreviews);
      setSelectedPreview(featured);
      setActiveFamily(featured?.fabricFamily || null);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load storefront previews");
    } finally {
      setLoading(false);
    }
  }

  const groupedFamilies = useMemo(() => {
    const groups: Record<string, StorefrontPreview[]> = {};
    for (const preview of previews) {
      const family = preview.fabricFamily || "Uncategorised";
      if (!groups[family]) groups[family] = [];
      groups[family].push(preview);
    }
    return groups;
  }, [previews]);

  const familyNames = Object.keys(groupedFamilies);
  const visiblePreviews = activeFamily ? groupedFamilies[activeFamily] || [] : previews;
  const isShowingOriginal = showOriginalImage || !selectedPreview;
  const mainImageUrl = isShowingOriginal ? product?.imageUrl || null : selectedPreview!.imageUrl;
  const mainImageLabel = isShowingOriginal ? "Original product image" : selectedPreview!.colourName;

  const useDropdown = products.length > CARD_THRESHOLD;
  const selectedSummary = products.find((p) => p.shopifyProductId === selectedProductId);

  return (
    <div style={{ padding: "24px", maxWidth: "1440px", margin: "0 auto", background: "#f1f5f9", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "4px 12px", borderRadius: "999px", background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4338ca", fontSize: "11px", fontWeight: 800, marginBottom: "12px", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
          👁️ Storefront view
        </div>
        <h1 style={{ margin: "0 0 6px 0", fontSize: "28px", fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" }}>
          Storefront Preview
        </h1>
        <p style={{ margin: 0, fontSize: "15px", color: "#64748b", lineHeight: 1.6 }}>
          See exactly what customers see — only approved previews are shown here.
        </p>
      </div>

      {/* Product selector */}
      {products.length === 0 ? (
        <div style={{ borderRadius: "20px", background: "#ffffff", border: "1px solid #e5e7eb", padding: "48px 32px", textAlign: "center", boxShadow: "0 2px 12px rgba(15,23,42,0.05)" }}>
          <div style={{ fontSize: "40px", marginBottom: "14px" }}>🎨</div>
          <div style={{ fontWeight: 800, fontSize: "16px", color: "#0f172a", marginBottom: "8px" }}>No approved previews yet</div>
          <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6 }}>
            Go to the Preview Manager and approve at least one preview to see it here.
          </div>
        </div>
      ) : useDropdown ? (
        /* ── Dropdown mode ── */
        <div style={{ borderRadius: "20px", background: "#ffffff", border: "1px solid #e5e7eb", padding: "20px", marginBottom: "20px", boxShadow: "0 2px 12px rgba(15,23,42,0.05)" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#64748b", marginBottom: "8px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
            Select a product
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedProductId || ""}
              onChange={(e) => { if (e.target.value) loadStorefrontPreviews(e.target.value); }}
              style={{
                flex: 1,
                minWidth: "260px",
                padding: "10px 14px",
                borderRadius: "12px",
                border: "1px solid #d1d5db",
                background: "#ffffff",
                fontSize: "14px",
                fontWeight: 600,
                color: "#0f172a",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              <option value="">— Choose a product —</option>
              {products.map((p) => (
                <option key={p.shopifyProductId} value={p.shopifyProductId}>
                  {p.title || "Untitled"} ({p.approvedCount} approved)
                </option>
              ))}
            </select>
            {selectedSummary && (
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                <span style={{ fontWeight: 700, color: "#22c55e" }}>●</span>{" "}
                {selectedSummary.approvedCount} approved colour{selectedSummary.approvedCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Card mode ── */
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#64748b", marginBottom: "10px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
            Select a product
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
            {products.map((p) => {
              const isActive = selectedProductId === p.shopifyProductId;
              return (
                <button
                  key={p.shopifyProductId}
                  type="button"
                  onClick={() => loadStorefrontPreviews(p.shopifyProductId)}
                  style={{
                    borderRadius: "16px",
                    border: isActive ? "2px solid #4f46e5" : "1px solid #e5e7eb",
                    background: isActive ? "#eef2ff" : "#ffffff",
                    padding: "14px",
                    cursor: "pointer",
                    textAlign: "left",
                    boxShadow: isActive ? "0 0 0 3px rgba(79,70,229,0.1)" : "0 2px 8px rgba(15,23,42,0.05)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {p.imageUrl && (
                    <img
                      src={p.imageUrl}
                      alt={p.title || "Product"}
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: "10px", display: "block", marginBottom: "10px" }}
                    />
                  )}
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.title || "Untitled product"}
                  </div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#22c55e" }}>
                    ● {p.approvedCount} approved colour{p.approvedCount !== 1 ? "s" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: "16px 20px", borderRadius: "16px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontWeight: 600, marginBottom: "20px" }}>
          Loading previews...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "16px 20px", borderRadius: "16px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontWeight: 600, marginBottom: "20px" }}>
          {error}
        </div>
      )}

      {/* Preview panel */}
      {!loading && previews.length > 0 && (
        <div style={{ borderRadius: "20px", background: "#ffffff", border: "1px solid #e5e7eb", padding: "24px", boxShadow: "0 2px 12px rgba(15,23,42,0.05)" }}>

          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h2 style={{ margin: "0 0 4px 0", fontSize: "20px", fontWeight: 800, color: "#0f172a" }}>
                {product?.title || "Product"}
              </h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
                Approved previews only · customer-facing view
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ padding: "6px 12px", borderRadius: "999px", background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#475569", fontSize: "12px", fontWeight: 700 }}>
                Showing: {mainImageLabel}
              </span>
              <button
                type="button"
                onClick={() => setShowOriginalImage((v) => !v)}
                disabled={!product?.imageUrl}
                style={{
                  padding: "8px 14px",
                  borderRadius: "999px",
                  border: isShowingOriginal ? "1px solid #4f46e5" : "1px solid #d1d5db",
                  background: isShowingOriginal ? "#4f46e5" : "#ffffff",
                  color: isShowingOriginal ? "#ffffff" : "#0f172a",
                  cursor: !product?.imageUrl ? "not-allowed" : "pointer",
                  font: "inherit",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
              >
                {isShowingOriginal ? "Viewing original" : "Show original"}
              </button>
            </div>
          </div>

          {/* Main image */}
          {mainImageUrl && (
            <div style={{ marginBottom: "20px", borderRadius: "16px", overflow: "hidden", border: "1px solid #e5e7eb", background: "#f8fafc" }}>
              <img
                src={mainImageUrl}
                alt={mainImageLabel}
                style={{ width: "100%", maxHeight: "560px", objectFit: "contain", display: "block" }}
              />
            </div>
          )}

          {/* Family tabs */}
          {familyNames.length > 1 && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              {familyNames.map((family) => (
                <button
                  key={family}
                  type="button"
                  onClick={() => setActiveFamily(family)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "999px",
                    border: activeFamily === family ? "1px solid #4f46e5" : "1px solid #d1d5db",
                    background: activeFamily === family ? "#4f46e5" : "#ffffff",
                    color: activeFamily === family ? "#ffffff" : "#0f172a",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  {family}
                  <span style={{ marginLeft: "6px", opacity: 0.7, fontWeight: 600 }}>
                    {groupedFamilies[family].length}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Colour grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px" }}>
            {visiblePreviews.map((preview) => {
              const isActive = !showOriginalImage && selectedPreview?.id === preview.id;
              return (
                <button
                  key={preview.id}
                  type="button"
                  onClick={() => { setSelectedPreview(preview); setShowOriginalImage(false); }}
                  style={{
                    border: isActive ? "2px solid #4f46e5" : "1px solid #e5e7eb",
                    borderRadius: "14px",
                    background: isActive ? "#eef2ff" : "#ffffff",
                    padding: "10px",
                    cursor: "pointer",
                    textAlign: "left",
                    boxShadow: isActive ? "0 0 0 3px rgba(79,70,229,0.1)" : "0 1px 4px rgba(15,23,42,0.06)",
                  }}
                >
                  <img
                    src={preview.imageUrl}
                    alt={preview.colourName}
                    style={{ width: "100%", borderRadius: "10px", display: "block", marginBottom: "8px", aspectRatio: "1/1", objectFit: "cover" }}
                  />
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {preview.colourName}
                  </div>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                    {preview.fabricFamily}{preview.featured ? " · ⭐" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* No previews for selected product */}
      {!loading && selectedProductId && previews.length === 0 && !error && (
        <div style={{ padding: "24px", borderRadius: "20px", background: "#ffffff", border: "1px solid #e5e7eb", color: "#64748b", textAlign: "center" }}>
          No approved previews found for this product.
        </div>
      )}
    </div>
  );
}
