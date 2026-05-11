import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

type ProductSummary = {
  id: string;
  shopifyProductId: string;
  title: string | null;
  imageUrl: string | null;
  previewCount: number;
  approvedCount: number;
  showOnStorefront: boolean;
  status: ProductStatus | null;
};

type LoaderData = {
  productsWithPreviews: ProductSummary[];
};

type PreviewItem = {
  id: string;
  shopifyProductId: string;
  fabricFamily: string;
  colourName: string;
  customerDisplayName: string | null;
  imageUrl: string;
  approvedForStorefront: boolean;
  featured: boolean;
  status: string;
  zoneId: string;
  swatchImageUrl: string | null;
};

type LoadedProduct = {
  id: string;
  showOnStorefront?: boolean;
  shopifyProductId: string;
  title: string | null;
  handle: string | null;
  imageUrl: string | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const products = await prisma.product.findMany({
    where: { shopId: shop.id, previews: { some: {} } },
    orderBy: { title: "asc" },
    include: {
      _count: { select: { previews: true } },
      previews: {
        where: { approvedForStorefront: true },
        select: { id: true },
      },
    },
  });

  // Batch-fetch product statuses (Active/Draft/Archived) from Shopify in one call
  const statusMap: Record<string, ProductStatus> = {};
  if (products.length > 0) {
    try {
      const ids = products.map((p) => p.shopifyProductId);
      const res = await admin.graphql(
        `query GetStatuses($ids: [ID!]!) {
           nodes(ids: $ids) {
             ... on Product { id status }
           }
         }`,
        { variables: { ids } },
      );
      const json = await res.json() as { data?: { nodes?: Array<{ id: string; status: string } | null> } };
      for (const node of json.data?.nodes ?? []) {
        if (node?.id && node?.status) {
          statusMap[node.id] = node.status as ProductStatus;
        }
      }
    } catch (e) {
      // Degrade gracefully — products still show, just without status badges
      console.error("Failed to fetch product statuses from Shopify:", e);
    }
  }

  return {
    productsWithPreviews: products.map((p) => ({
      id: p.id,
      shopifyProductId: p.shopifyProductId,
      title: p.title,
      imageUrl: p.imageUrl,
      previewCount: p._count.previews,
      approvedCount: p.previews.length,
      showOnStorefront: p.showOnStorefront,
      status: statusMap[p.shopifyProductId] ?? null,
    })),
  } satisfies LoaderData;
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const pageStyle: CSSProperties = { padding: "24px", maxWidth: "1600px", margin: "0 auto" };

const heroCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "22px",
  background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 55%, #eef2ff 100%)",
  padding: "24px",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.04)",
  marginBottom: "20px",
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "18px",
  background: "#ffffff",
  padding: "18px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
};

const softCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "16px",
  background: "#f8fafc",
  padding: "14px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid #111827",
  background: "#111827",
  color: "#ffffff",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid #d1d5db",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #d1d5db",
  font: "inherit",
  boxSizing: "border-box",
};

function getStatusPillStyle(active: boolean, activeType: "green" | "blue" = "green"): CSSProperties {
  const activeColours =
    activeType === "blue"
      ? { border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8" }
      : { border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534" };

  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "999px",
    border: active ? activeColours.border : "1px solid #e5e7eb",
    background: active ? activeColours.background : "#f8fafc",
    color: active ? activeColours.color : "#475569",
    fontSize: "13px",
    fontWeight: 700,
  };
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function PreviewManagerPage() {
  const { productsWithPreviews } = useLoaderData<typeof loader>();

  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [storefrontSaving, setStorefrontSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loadedProduct, setLoadedProduct] = useState<LoadedProduct | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftFamilies, setDraftFamilies] = useState<Record<string, string>>({});
  const [draftDisplayNames, setDraftDisplayNames] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState("");
  const [manualCategories, setManualCategories] = useState<string[]>([]);
  const [categoryWarning, setCategoryWarning] = useState<string | null>(null);
  // Batch selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);
  // Regeneration
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Filters & sort
  const [filterStatus, setFilterStatus] = useState<"all" | "DRAFT" | "APPROVED" | "HIDDEN" | "FEATURED">("all");
  const [filterStorefront, setFilterStorefront] = useState<"all" | "approved" | "unapproved">("all");
  const [filterFeatured, setFilterFeatured] = useState(false);
  const [sortPreviews, setSortPreviews] = useState<"featured-first" | "az" | "za">("featured-first");
  const [sortProducts, setSortProducts] = useState<"az" | "za" | "most" | "least">("az");
  const [filterProductStatus, setFilterProductStatus] = useState<"all" | ProductStatus>("all");
  const [filterStorefrontReady, setFilterStorefrontReady] = useState(false);

  async function loadPreviews(forcedProductId?: string) {
    const idToUse = (forcedProductId || productId).trim();
    if (!idToUse) { setError("Missing product id"); return; }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/previews?productId=${encodeURIComponent(idToUse)}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Failed to load previews");

      const nextPreviews: PreviewItem[] = data.previews || [];
      setLoadedProduct(data.product || null);
      setPreviews(nextPreviews);
      setSelectedIds([]);
      setFilterStatus("all");
      setFilterStorefront("all");
      setFilterFeatured(false);
      setSortPreviews("featured-first");

      setDraftNames(Object.fromEntries(nextPreviews.map((p) => [p.id, p.colourName || ""])));
      setDraftFamilies(Object.fromEntries(nextPreviews.map((p) => [p.id, p.fabricFamily || ""])));
      setDraftDisplayNames(Object.fromEntries(nextPreviews.map((p) => [p.id, p.customerDisplayName ?? ""])));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load previews");
    } finally {
      setLoading(false);
    }
  }

  async function updatePreview(previewId: string, updates: Partial<PreviewItem> & { customerDisplayName?: string | null }) {
    setSavingId(previewId);
    try {
      const response = await fetch("/api/preview-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewId,
          approvedForStorefront: updates.approvedForStorefront,
          featured: updates.featured,
          status: updates.status,
          colourName: updates.colourName,
          fabricFamily: updates.fabricFamily,
          customerDisplayName: updates.customerDisplayName,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update preview");

      setPreviews((prev) => prev.map((item) => (item.id === previewId ? { ...item, ...data.preview } : item)));

      if (data.preview?.colourName !== undefined) {
        setDraftNames((prev) => ({ ...prev, [previewId]: data.preview.colourName }));
      }
      if (data.preview?.fabricFamily !== undefined) {
        setDraftFamilies((prev) => ({ ...prev, [previewId]: data.preview.fabricFamily }));
      }
      if ("customerDisplayName" in data.preview) {
        setDraftDisplayNames((prev) => ({ ...prev, [previewId]: data.preview.customerDisplayName ?? "" }));
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to update preview");
    } finally {
      setSavingId(null);
    }
  }

  async function batchApprove(approve: boolean) {
    if (selectedIds.length === 0) return;
    setBatchSaving(true);
    for (const id of selectedIds) {
      await updatePreview(id, { approvedForStorefront: approve });
    }
    setSelectedIds([]);
    setBatchSaving(false);
  }

  async function regeneratePreview(preview: PreviewItem) {
    if (!loadedProduct) return;
    if (!preview.swatchImageUrl) {
      alert("Cannot regenerate: the original swatch image is no longer available. Upload the swatch again from the Visualiser.");
      return;
    }

    setRegeneratingId(preview.id);
    try {
      const formData = new FormData();
      formData.append("productId", loadedProduct.shopifyProductId);
      formData.append("zoneId", preview.zoneId);
      formData.append("swatchUrl", preview.swatchImageUrl);
      formData.append("fabricFamily", preview.fabricFamily);
      formData.append("colourName", preview.colourName);

      const response = await fetch("/api/generate-preview", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Regeneration failed");

      if (data.preview?.url) {
        setPreviews((prev) =>
          prev.map((p) => (p.id === preview.id ? { ...p, imageUrl: data.preview.url } : p))
        );
      }
      // Reload to get the fresh record
      await loadPreviews();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to regenerate preview");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function toggleFeatured(preview: PreviewItem) {
    setSavingId(preview.id);
    try {
      if (!preview.featured) {
        const featuredItems = previews.filter((item) => item.featured && item.id !== preview.id);
        for (const item of featuredItems) {
          await fetch("/api/preview-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ previewId: item.id, featured: false }),
          });
        }
      }

      const response = await fetch("/api/preview-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: preview.id, featured: !preview.featured }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update featured preview");

      setPreviews((prev) =>
        prev.map((item) => {
          if (item.id === preview.id) return data.preview;
          if (!preview.featured) return { ...item, featured: false };
          return item;
        })
      );
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to update featured preview");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleProductStorefront(checked: boolean) {
    if (!loadedProduct) return;
    setStorefrontSaving(true);
    try {
      const response = await fetch("/api/product-storefront-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyProductId: loadedProduct.shopifyProductId, showOnStorefront: checked }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update storefront setting");
      setLoadedProduct((prev) => (prev ? { ...prev, showOnStorefront: checked } : prev));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to update storefront setting");
    } finally {
      setStorefrontSaving(false);
    }
  }

  function toggleSelectPreview(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function removeCategory(categoryToRemove: string) {
    const trimmed = categoryToRemove.trim();
    if (!trimmed) return;

    const inUse =
      previews.some((p) => (p.fabricFamily || "").trim() === trimmed) ||
      Object.values(draftFamilies).some((v) => (v || "").trim() === trimmed);

    if (inUse) {
      setCategoryWarning(`Cannot remove "${trimmed}" — one or more previews are still assigned to it. Reassign those first.`);
      return;
    }
    if (categoryOptions.length <= 1) {
      setCategoryWarning("At least 1 category must remain.");
      return;
    }
    setManualCategories((prev) => prev.filter((item) => item.trim() !== trimmed));
    setCategoryWarning(null);
  }

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    previews.forEach((p) => { if (p.fabricFamily?.trim()) set.add(p.fabricFamily.trim()); });
    Object.values(draftFamilies).forEach((v) => { if (v?.trim()) set.add(v.trim()); });
    manualCategories.forEach((v) => { if (v?.trim()) set.add(v.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [previews, draftFamilies, manualCategories]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase().trim();
    return productsWithPreviews.filter((p) => {
      if (q && !(p.title || "Untitled product").toLowerCase().includes(q)) return false;
      if (filterProductStatus !== "all" && p.status !== filterProductStatus) return false;
      if (filterStorefrontReady && !(p.showOnStorefront && p.approvedCount > 0)) return false;
      return true;
    });
  }, [productsWithPreviews, productSearch, filterProductStatus, filterStorefrontReady]);

  const sortedProducts = useMemo(() => {
    const arr = [...filteredProducts];
    if (sortProducts === "za")   arr.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    else if (sortProducts === "most")  arr.sort((a, b) => b.previewCount - a.previewCount);
    else if (sortProducts === "least") arr.sort((a, b) => a.previewCount - b.previewCount);
    else arr.sort((a, b) => (a.title || "").localeCompare(b.title || "")); // az
    return arr;
  }, [filteredProducts, sortProducts]);

  const filteredAndSortedPreviews = useMemo(() => {
    let result = [...previews];
    if (filterStatus !== "all")          result = result.filter((p) => p.status === filterStatus);
    if (filterStorefront === "approved")   result = result.filter((p) => p.approvedForStorefront);
    if (filterStorefront === "unapproved") result = result.filter((p) => !p.approvedForStorefront);
    if (filterFeatured)                    result = result.filter((p) => p.featured);
    if (sortPreviews === "az") result.sort((a, b) => a.colourName.localeCompare(b.colourName));
    if (sortPreviews === "za") result.sort((a, b) => b.colourName.localeCompare(a.colourName));
    if (sortPreviews === "featured-first") result.sort((a, b) => Number(b.featured) - Number(a.featured));
    return result;
  }, [previews, filterStatus, filterStorefront, filterFeatured, sortPreviews]);

  const selectedProductSummary = useMemo(
    () => productsWithPreviews.find((p) => p.shopifyProductId === productId) ?? null,
    [productsWithPreviews, productId]
  );

  async function deletePreview(previewId: string) {
    if (!window.confirm("Remove this colour? This cannot be undone.")) return;
    setDeletingId(previewId);
    try {
      const response = await fetch("/api/preview-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete preview");
      setPreviews((prev) => prev.filter((p) => p.id !== previewId));
      setSelectedIds((prev) => prev.filter((id) => id !== previewId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete preview");
    } finally {
      setDeletingId(null);
    }
  }

  const grouped = useMemo(() => {
    const groups: Record<string, PreviewItem[]> = {};
    for (const preview of filteredAndSortedPreviews) {
      const key = preview.fabricFamily || "Uncategorised";
      if (!groups[key]) groups[key] = [];
      groups[key].push(preview);
    }
    return groups;
  }, [filteredAndSortedPreviews]);

  const approvedCount = previews.filter((p) => p.approvedForStorefront).length;
  const featuredCount = previews.filter((p) => p.featured).length;

  return (
    <div style={pageStyle}>
      {/* ── Hero ── */}
      <div style={heroCardStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(260px, 0.9fr)", gap: "16px", alignItems: "stretch" }}>
          <div>
            <div style={{ display: "inline-flex", padding: "6px 12px", borderRadius: "999px", background: "#eef2ff", color: "#4338ca", fontSize: "12px", fontWeight: 700, marginBottom: "14px" }}>
              Preview Review Workspace
            </div>
            <h1 style={{ margin: "0 0 8px 0", fontSize: "30px", lineHeight: 1.1 }}>Preview Manager</h1>
            <p style={{ margin: 0, color: "#64748b", maxWidth: "780px", lineHeight: 1.6 }}>
              Rename previews, set what customers see, approve for storefront, batch-approve entire sets at once, and regenerate any image with the latest rendering.
            </p>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "18px", background: "#ffffff", padding: "16px", display: "grid", gap: "10px" }}>
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700 }}>QUICK SUMMARY</div>
            {[
              { label: "Total previews", value: previews.length },
              { label: "Approved", value: approvedCount },
              { label: "Featured", value: featuredCount },
            ].map((stat) => (
              <div key={stat.label} style={softCardStyle}>
                <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "2px" }}>{stat.label}</div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827" }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Product picker ── */}
      <div style={{ ...cardStyle, marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "12px" }}>SELECT PRODUCT</div>
        {productsWithPreviews.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>No previews generated yet. Go to the Visualiser to create your first preview.</p>
        ) : (
          <div>
            {/* Selected product chip */}
            {selectedProductSummary && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "12px", background: "#111827", color: "#fff", marginBottom: "12px" }}>
                {selectedProductSummary.imageUrl && (
                  <img src={selectedProductSummary.imageUrl} alt="" style={{ width: "34px", height: "34px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.15)" }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedProductSummary.title || "Untitled product"}</div>
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>{selectedProductSummary.previewCount} preview{selectedProductSummary.previewCount !== 1 ? "s" : ""}</div>
                </div>
                <button type="button" onClick={() => { setProductId(""); setProductSearch(""); setPreviews([]); setLoadedProduct(null); setSelectedIds([]); }} style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px", lineHeight: 1, padding: "0 2px", flexShrink: 0 }} title="Clear selection">×</button>
              </div>
            )}

            {/* Search + sort row */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <input
                type="search"
                placeholder={`Search ${productsWithPreviews.length} products…`}
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              <select
                value={sortProducts}
                onChange={(e) => setSortProducts(e.target.value as typeof sortProducts)}
                style={{ ...inputStyle, width: "auto", flexShrink: 0 }}
              >
                <option value="az">A → Z</option>
                <option value="za">Z → A</option>
                <option value="most">Most previews</option>
                <option value="least">Fewest previews</option>
              </select>
            </div>

            {/* Status filter pills */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
              {(["all", "ACTIVE", "DRAFT", "ARCHIVED"] as const).map((s) => {
                const isActive = filterProductStatus === s;
                const colours: Record<string, { bg: string; color: string; border: string }> = {
                  all:      { bg: isActive ? "#111827" : "#f8fafc", color: isActive ? "#fff" : "#475569", border: isActive ? "#111827" : "#e5e7eb" },
                  ACTIVE:   { bg: isActive ? "#16a34a" : "#f0fdf4", color: isActive ? "#fff" : "#16a34a", border: isActive ? "#16a34a" : "#bbf7d0" },
                  DRAFT:    { bg: isActive ? "#d97706" : "#fffbeb", color: isActive ? "#fff" : "#d97706", border: isActive ? "#d97706" : "#fde68a" },
                  ARCHIVED: { bg: isActive ? "#6b7280" : "#f8fafc", color: isActive ? "#fff" : "#6b7280", border: isActive ? "#6b7280" : "#d1d5db" },
                };
                const c = colours[s];
                const count = s === "all"
                  ? productsWithPreviews.length
                  : productsWithPreviews.filter((p) => p.status === s).length;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilterProductStatus(s)}
                    style={{ padding: "5px 12px", borderRadius: "999px", border: `1px solid ${c.border}`, background: c.bg, color: c.color, cursor: "pointer", font: "inherit", fontSize: "12px", fontWeight: 700 }}
                  >
                    {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()} ({count})
                  </button>
                );
              })}

              {/* Storefront-ready filter */}
              {(() => {
                const count = productsWithPreviews.filter((p) => p.showOnStorefront && p.approvedCount > 0).length;
                return (
                  <button
                    type="button"
                    onClick={() => setFilterStorefrontReady((v) => !v)}
                    style={{
                      padding: "5px 12px", borderRadius: "999px", font: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer",
                      border: filterStorefrontReady ? "1px solid #7c3aed" : "1px solid #ddd8fe",
                      background: filterStorefrontReady ? "#7c3aed" : "#f5f3ff",
                      color: filterStorefrontReady ? "#fff" : "#7c3aed",
                    }}
                  >
                    ✅ Live on storefront ({count})
                  </button>
                );
              })()}
            </div>

            {/* Scrollable product list */}
            <div style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "12px", background: "#fff" }}>
              {sortedProducts.length === 0 ? (
                <div style={{ padding: "12px 14px", fontSize: "13px", color: "#94a3b8" }}>No products match &ldquo;{productSearch}&rdquo;</div>
              ) : (
                sortedProducts.map((product, idx) => {
                  const isSelected = productId === product.shopifyProductId;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={async () => {
                        setProductId(product.shopifyProductId);
                        setProductSearch("");
                        await loadPreviews(product.shopifyProductId);
                      }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 12px", border: "none",
                        borderBottom: idx < sortedProducts.length - 1 ? "1px solid #f1f5f9" : "none",
                        background: isSelected ? "#f0f9ff" : "#fff",
                        cursor: "pointer", textAlign: "left", font: "inherit",
                      }}
                    >
                      {product.imageUrl && (
                        <img src={product.imageUrl} alt="" style={{ width: "32px", height: "32px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: isSelected ? 700 : 500, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title || "Untitled product"}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>{product.previewCount} preview{product.previewCount !== 1 ? "s" : ""}</span>
                          {product.status && (
                            <span style={{
                              fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "999px",
                              background: product.status === "ACTIVE" ? "#f0fdf4" : product.status === "DRAFT" ? "#fffbeb" : "#f8fafc",
                              color: product.status === "ACTIVE" ? "#16a34a" : product.status === "DRAFT" ? "#d97706" : "#6b7280",
                              border: `1px solid ${product.status === "ACTIVE" ? "#bbf7d0" : product.status === "DRAFT" ? "#fde68a" : "#d1d5db"}`,
                            }}>
                              {product.status.charAt(0) + product.status.slice(1).toLowerCase()}
                            </span>
                          )}
                          {product.showOnStorefront && product.approvedCount > 0 && (
                            <span style={{
                              fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "999px",
                              background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd8fe",
                            }}>
                              ✅ {product.approvedCount} live
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && <span style={{ color: "#2563eb", fontWeight: 800, fontSize: "13px", flexShrink: 0 }}>✓</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {productId && !loading && previews.length > 0 && (
          <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "16px", alignItems: "start" }}>
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "8px" }}>FABRIC FAMILY / CATEGORY OPTIONS</div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Add category e.g. Plush, Suede, Velvet" style={{ ...inputStyle, maxWidth: "320px" }} />
                  <button type="button" onClick={() => { const t = newCategory.trim(); if (!t) return; setManualCategories((prev) => prev.includes(t) ? prev : [...prev, t]); setNewCategory(""); setCategoryWarning(null); }} style={secondaryButtonStyle}>
                    Add category
                  </button>
                </div>
                {categoryWarning && <div style={{ marginTop: "10px", maxWidth: "700px", padding: "10px 12px", borderRadius: "10px", background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: "13px", lineHeight: 1.5 }}>{categoryWarning}</div>}
                {categoryOptions.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                    {categoryOptions.map((option) => {
                      const inUse = previews.some((p) => (p.fabricFamily || "").trim() === option.trim()) || Object.values(draftFamilies).some((v) => (v || "").trim() === option.trim());
                      return (
                        <div key={option} style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 700, background: "#f8fafc", border: "1px solid #e5e7eb", color: "#475569" }}>
                          <span>{option}</span>
                          <button type="button" onClick={() => removeCategory(option)} title={inUse ? "Still assigned to previews" : "Remove"} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "12px", fontWeight: 700, color: inUse ? "#94a3b8" : "#dc2626", padding: 0, lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => loadPreviews()} style={secondaryButtonStyle}>Reload previews</button>
            </div>
          </div>
        )}
      </div>

      {loading && <div style={{ ...softCardStyle, marginBottom: "18px" }}>Loading previews...</div>}
      {error && <div style={{ ...softCardStyle, marginBottom: "18px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}>{error}</div>}

      {/* ── Product info + storefront toggle ── */}
      {loadedProduct && (
        <div style={{ ...cardStyle, marginBottom: "22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)", gap: "16px", alignItems: "stretch" }}>
            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              {loadedProduct.imageUrl && (
                <img src={loadedProduct.imageUrl} alt={loadedProduct.title || "Product image"} style={{ width: "96px", height: "96px", objectFit: "cover", borderRadius: "14px", border: "1px solid #e5e7eb", background: "#fff" }} />
              )}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "6px" }}>CURRENT PRODUCT</div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827", marginBottom: "4px" }}>{loadedProduct.title || "Untitled product"}</div>
                <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>{loadedProduct.shopifyProductId}</div>
              </div>
            </div>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "16px", padding: "16px", background: "#f8fafc", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, color: "#111827", marginBottom: "6px" }}>Storefront visibility</div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>Show or hide this product's colour gallery for customers.</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <span style={getStatusPillStyle(!!loadedProduct.showOnStorefront)}>
                  <span>{loadedProduct.showOnStorefront ? "✓" : "○"}</span>
                  <span>{loadedProduct.showOnStorefront ? "Visible on storefront" : "Hidden from storefront"}</span>
                </span>
                <button type="button" disabled={storefrontSaving} onClick={() => toggleProductStorefront(!loadedProduct.showOnStorefront)} style={{ ...secondaryButtonStyle, border: loadedProduct.showOnStorefront ? "1px solid #dc2626" : "1px solid #111827", color: loadedProduct.showOnStorefront ? "#dc2626" : "#111827" }}>
                  {storefrontSaving ? "Saving..." : loadedProduct.showOnStorefront ? "Hide product" : "Show product"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && loadedProduct && previews.length === 0 && (
        <div style={cardStyle}><h2 style={{ marginTop: 0 }}>No previews found</h2><p style={{ marginBottom: 0, color: "#64748b" }}>Create previews in the Visualiser first.</p></div>
      )}

      {/* ── Batch action bar ── */}
      {selectedIds.length > 0 && (
        <div
          style={{
            position: "sticky", top: "16px", zIndex: 100,
            marginBottom: "16px", padding: "14px 18px",
            borderRadius: "16px", background: "#0f172a",
            border: "1px solid #1e293b",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: "14px", flexWrap: "wrap",
          }}
        >
          <div style={{ color: "#fff", fontWeight: 700, fontSize: "14px" }}>
            {selectedIds.length} preview{selectedIds.length !== 1 ? "s" : ""} selected
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={batchSaving}
              onClick={() => batchApprove(true)}
              style={{ padding: "8px 16px", borderRadius: "10px", border: "1px solid #22c55e", background: "#22c55e", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 700, fontSize: "13px" }}
            >
              {batchSaving ? "Saving..." : "Approve all"}
            </button>
            <button
              type="button"
              disabled={batchSaving}
              onClick={() => batchApprove(false)}
              style={{ padding: "8px 16px", borderRadius: "10px", border: "1px solid #64748b", background: "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 700, fontSize: "13px" }}
            >
              Unapprove all
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              style={{ padding: "8px 16px", borderRadius: "10px", border: "1px solid #475569", background: "transparent", color: "#94a3b8", cursor: "pointer", font: "inherit", fontWeight: 700, fontSize: "13px" }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {/* ── Preview groups ── */}
      {Object.entries(grouped).map(([family, items]) => {
        const familyIds = items.map((p) => p.id);
        const allSelected = familyIds.every((id) => selectedIds.includes(id));

        return (
          <div key={family} style={{ marginBottom: "26px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <h2 style={{ margin: "0 0 4px 0", fontSize: "22px" }}>{family}</h2>
                <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>{items.length} preview{items.length !== 1 ? "s" : ""} in this family</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (allSelected) {
                    setSelectedIds((prev) => prev.filter((id) => !familyIds.includes(id)));
                  } else {
                    setSelectedIds((prev) => Array.from(new Set([...prev, ...familyIds])));
                  }
                }}
                style={{ ...secondaryButtonStyle, fontSize: "12px", padding: "7px 12px" }}
              >
                {allSelected ? "Deselect all in " : "Select all in "}{family}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 300px))", gap: "16px", justifyContent: "start" }}>
              {items.map((preview) => {
                const isApproved = preview.approvedForStorefront;
                const isFeatured = preview.featured;
                const isSaving = savingId === preview.id;
                const isRegenerating = regeneratingId === preview.id;
                const isSelected = selectedIds.includes(preview.id);
                const currentDraftName = draftNames[preview.id] ?? preview.colourName;
                const currentDraftFamily = draftFamilies[preview.id] ?? preview.fabricFamily ?? "";
                const currentDraftDisplayName = draftDisplayNames[preview.id] ?? "";

                return (
                  <div
                    key={preview.id}
                    style={{
                      ...cardStyle, padding: "14px",
                      outline: isSelected ? "3px solid #4f46e5" : "none",
                      outlineOffset: "2px",
                    }}
                  >
                    {/* Image + selection checkbox */}
                    <div style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: "14px", overflow: "hidden", background: "#f8fafc", border: "1px solid #e5e7eb", marginBottom: "12px" }}>
                      <img
                        src={preview.imageUrl}
                        alt={preview.colourName}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: isRegenerating ? 0.4 : 1, transition: "opacity 0.2s" }}
                      />
                      {isRegenerating && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "#4f46e5", background: "rgba(255,255,255,0.6)" }}>
                          Regenerating…
                        </div>
                      )}
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleSelectPreview(preview.id)}
                        style={{
                          position: "absolute", top: "8px", right: "8px",
                          width: "28px", height: "28px", borderRadius: "8px",
                          border: isSelected ? "2px solid #4f46e5" : "2px solid rgba(255,255,255,0.8)",
                          background: isSelected ? "#4f46e5" : "rgba(255,255,255,0.9)",
                          color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "14px", fontWeight: 900, boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                        }}
                      >
                        {isSelected ? "✓" : ""}
                      </button>
                    </div>

                    {/* Internal (swatch) name */}
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700, marginBottom: "5px", letterSpacing: "0.06em" }}>
                        INTERNAL NAME
                      </div>
                      <input
                        type="text"
                        value={currentDraftName}
                        onChange={(e) => setDraftNames((prev) => ({ ...prev, [preview.id]: e.target.value }))}
                        placeholder="Colour name"
                        style={inputStyle}
                      />
                    </div>

                    {/* Customer display name */}
                    <div style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "11px", color: "#6366f1", fontWeight: 700, marginBottom: "5px", letterSpacing: "0.06em" }}>
                        STOREFRONT NAME <span style={{ fontWeight: 400, color: "#94a3b8" }}>(what customers see)</span>
                      </div>
                      <input
                        type="text"
                        value={currentDraftDisplayName}
                        onChange={(e) => setDraftDisplayNames((prev) => ({ ...prev, [preview.id]: e.target.value }))}
                        placeholder={`Leave blank to use "${currentDraftName}"`}
                        style={{ ...inputStyle, border: currentDraftDisplayName ? "1px solid #a5b4fc" : "1px solid #d1d5db" }}
                      />
                    </div>

                    {/* Family / category */}
                    <div style={{ marginBottom: "12px" }}>
                      <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700, marginBottom: "5px", letterSpacing: "0.06em" }}>FAMILY / CATEGORY</div>
                      <select value={currentDraftFamily} onChange={(e) => setDraftFamilies((prev) => ({ ...prev, [preview.id]: e.target.value }))} style={inputStyle}>
                        <option value="">Select a category</option>
                        {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>

                    {/* Status pills */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                      <span style={getStatusPillStyle(isApproved)}>
                        <span>{isApproved ? "✓" : "○"}</span>
                        <span>{isApproved ? "Approved" : "Not approved"}</span>
                      </span>
                      <span style={getStatusPillStyle(isFeatured, "blue")}>
                        <span>{isFeatured ? "★" : "☆"}</span>
                        <span>{isFeatured ? "Featured" : "Standard"}</span>
                      </span>
                    </div>

                    {/* Save details + Approve row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                      <button
                        type="button"
                        disabled={isSaving || currentDraftName.trim() === "" || currentDraftFamily.trim() === ""}
                        onClick={() => updatePreview(preview.id, {
                          colourName: currentDraftName.trim(),
                          fabricFamily: currentDraftFamily.trim(),
                          customerDisplayName: currentDraftDisplayName.trim() || null,
                        })}
                        style={secondaryButtonStyle}
                      >
                        {isSaving ? "Saving…" : "Save details"}
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => updatePreview(preview.id, { approvedForStorefront: !isApproved })}
                        style={{ ...primaryButtonStyle, background: isApproved ? "#ffffff" : "#111827", color: isApproved ? "#111827" : "#ffffff", border: isApproved ? "1px solid #d1d5db" : "1px solid #111827" }}
                      >
                        {isSaving ? "Saving…" : isApproved ? "Unapprove" : "Approve"}
                      </button>
                    </div>

                    {/* Featured + Regenerate row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => toggleFeatured(preview)}
                        style={{ ...secondaryButtonStyle, border: isFeatured ? "1px solid #2563eb" : "1px solid #d1d5db", color: isFeatured ? "#1d4ed8" : "#111827", padding: "9px 10px", fontSize: "13px" }}
                      >
                        {isSaving ? "…" : isFeatured ? "★ Featured" : "Set featured"}
                      </button>
                      <button
                        type="button"
                        disabled={isRegenerating || !preview.swatchImageUrl}
                        onClick={() => regeneratePreview(preview)}
                        title={!preview.swatchImageUrl ? "Swatch image no longer available" : "Regenerate with latest rendering"}
                        style={{
                          ...secondaryButtonStyle,
                          padding: "9px 10px", fontSize: "13px",
                          opacity: !preview.swatchImageUrl ? 0.4 : 1,
                          cursor: !preview.swatchImageUrl ? "not-allowed" : "pointer",
                        }}
                      >
                        {isRegenerating ? "…" : "↺ Regenerate"}
                      </button>
                    </div>

                    {/* Remove colour */}
                    <button
                      type="button"
                      disabled={deletingId === preview.id}
                      onClick={() => deletePreview(preview.id)}
                      style={{
                        marginTop: "8px", width: "100%",
                        padding: "8px 10px", borderRadius: "10px",
                        border: "1px solid #fecaca", background: "#fff",
                        color: "#dc2626", cursor: "pointer",
                        font: "inherit", fontSize: "13px", fontWeight: 700,
                        opacity: deletingId === preview.id ? 0.6 : 1,
                      }}
                    >
                      {deletingId === preview.id ? "Removing…" : "✕ Remove colour"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
