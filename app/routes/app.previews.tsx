import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

type ProductSummary = {
  id: string;
  shopifyProductId: string;
  title: string | null;
  imageUrl: string | null;
  previewCount: number;
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
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const products = await prisma.product.findMany({
    where: { shopId: shop.id, previews: { some: {} } },
    orderBy: { title: "asc" },
    select: {
      id: true,
      shopifyProductId: true,
      title: true,
      imageUrl: true,
      _count: { select: { previews: true } },
    },
  });

  return {
    productsWithPreviews: products.map((p) => ({
      id: p.id,
      shopifyProductId: p.shopifyProductId,
      title: p.title,
      imageUrl: p.imageUrl,
      previewCount: p._count.previews,
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
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
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

  const grouped = useMemo(() => {
    const groups: Record<string, PreviewItem[]> = {};
    for (const preview of previews) {
      const key = preview.fabricFamily || "Uncategorised";
      if (!groups[key]) groups[key] = [];
      groups[key].push(preview);
    }
    return groups;
  }, [previews]);

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
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {productsWithPreviews.map((product) => {
              const isSelected = productId === product.shopifyProductId;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={async () => {
                    setProductId(product.shopifyProductId);
                    await loadPreviews(product.shopifyProductId);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
                    borderRadius: "12px", border: isSelected ? "2px solid #111827" : "1px solid #e5e7eb",
                    background: isSelected ? "#111827" : "#ffffff", color: isSelected ? "#ffffff" : "#111827",
                    cursor: "pointer", font: "inherit", fontWeight: isSelected ? 700 : 500, textAlign: "left",
                  }}
                >
                  {product.imageUrl && (
                    <img src={product.imageUrl} alt="" style={{ width: "36px", height: "36px", borderRadius: "6px", objectFit: "cover", border: isSelected ? "1px solid rgba(255,255,255,0.2)" : "1px solid #e5e7eb", flexShrink: 0 }} />
                  )}
                  <div>
                    <div style={{ fontSize: "13px", lineHeight: 1.3 }}>{product.title || "Untitled product"}</div>
                    <div style={{ fontSize: "11px", opacity: isSelected ? 0.7 : 0.5, marginTop: "2px" }}>{product.previewCount} preview{product.previewCount !== 1 ? "s" : ""}</div>
                  </div>
                </button>
              );
            })}
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
