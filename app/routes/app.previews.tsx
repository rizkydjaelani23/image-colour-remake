import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type LoaderData = {
  apiKey: string;
};

type PreviewItem = {
  id: string;
  shopifyProductId: string;
  fabricFamily: string;
  colourName: string;
  imageUrl: string;
  approvedForStorefront: boolean;
  featured: boolean;
  status: string;
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
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}

const pageStyle: CSSProperties = {
  padding: "24px",
  maxWidth: "1600px",
  margin: "0 auto",
};

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
      ? {
          border: "1px solid #bfdbfe",
          background: "#eff6ff",
          color: "#1d4ed8",
        }
      : {
          border: "1px solid #bbf7d0",
          background: "#f0fdf4",
          color: "#166534",
        };

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

export default function PreviewManagerPage() {
  useLoaderData<typeof loader>();

  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [storefrontSaving, setStorefrontSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loadedProduct, setLoadedProduct] = useState<LoadedProduct | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftFamilies, setDraftFamilies] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState("");
  const [manualCategories, setManualCategories] = useState<string[]>([]);
  const [categoryWarning, setCategoryWarning] = useState<string | null>(null);

  async function loadPreviews(forcedProductId?: string) {
    const idToUse = (forcedProductId || productId).trim();

    if (!idToUse) {
      setError("Missing product id");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/previews?productId=${encodeURIComponent(idToUse)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load previews");
      }

      const nextPreviews = data.previews || [];

      setLoadedProduct(data.product || null);
      setPreviews(nextPreviews);

      setDraftNames(
        Object.fromEntries(
          nextPreviews.map((preview: PreviewItem) => [
            preview.id,
            preview.colourName || "",
          ])
        )
      );

      setDraftFamilies(
        Object.fromEntries(
          nextPreviews.map((preview: PreviewItem) => [
            preview.id,
            preview.fabricFamily || "",
          ])
        )
      );
    } catch (err) {
      console.error(err);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load previews");
      }
    } finally {
      setLoading(false);
    }
  }

  async function updatePreview(
    previewId: string,
    updates: Partial<PreviewItem>,
  ) {
    setSavingId(previewId);

    try {
      const response = await fetch("/api/preview-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previewId,
          approvedForStorefront: updates.approvedForStorefront,
          featured: updates.featured,
          status: updates.status,
          colourName: updates.colourName,
          fabricFamily: updates.fabricFamily,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update preview");
      }

      setPreviews((prev) =>
        prev.map((item) => (item.id === previewId ? data.preview : item)),
      );

      if (data.preview?.colourName) {
        setDraftNames((prev) => ({
          ...prev,
          [previewId]: data.preview.colourName,
        }));
      }

      if (data.preview?.fabricFamily) {
        setDraftFamilies((prev) => ({
          ...prev,
          [previewId]: data.preview.fabricFamily,
        }));
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to update preview");
    } finally {
      setSavingId(null);
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
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              previewId: item.id,
              featured: false,
            }),
          });
        }
      }

      const response = await fetch("/api/preview-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previewId: preview.id,
          featured: !preview.featured,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update featured preview");
      }

      setPreviews((prev) =>
        prev.map((item) => {
          if (item.id === preview.id) {
            return data.preview;
          }

          if (!preview.featured) {
            return { ...item, featured: false };
          }

          return item;
        }),
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shopifyProductId: loadedProduct.shopifyProductId,
          showOnStorefront: checked,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update storefront setting");
      }

      setLoadedProduct((prev) =>
        prev ? { ...prev, showOnStorefront: checked } : prev
      );
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to update storefront setting");
    } finally {
      setStorefrontSaving(false);
    }
  }

  function removeCategory(categoryToRemove: string) {
    const trimmed = categoryToRemove.trim();
    if (!trimmed) return;

    const categoriesInUse = previews.some(
      (preview) => (preview.fabricFamily || "").trim() === trimmed
    );

    const draftCategoriesInUse = Object.values(draftFamilies).some(
      (value) => (value || "").trim() === trimmed
    );

    if (categoriesInUse || draftCategoriesInUse) {
      setCategoryWarning(
        `Cannot remove "${trimmed}" because one or more previews are still assigned to it. Reassign those previews first.`
      );
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

    previews.forEach((preview) => {
      if (preview.fabricFamily?.trim()) {
        set.add(preview.fabricFamily.trim());
      }
    });

    Object.values(draftFamilies).forEach((value) => {
      if (value?.trim()) {
        set.add(value.trim());
      }
    });

    manualCategories.forEach((value) => {
      if (value?.trim()) {
        set.add(value.trim());
      }
    });

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

  const approvedCount = previews.filter((preview) => preview.approvedForStorefront).length;
  const featuredCount = previews.filter((preview) => preview.featured).length;

  return (
    <div style={pageStyle}>
      <div style={heroCardStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.5fr) minmax(260px, 0.9fr)",
            gap: "16px",
            alignItems: "stretch",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                padding: "6px 12px",
                borderRadius: "999px",
                background: "#eef2ff",
                color: "#4338ca",
                fontSize: "12px",
                fontWeight: 700,
                marginBottom: "14px",
              }}
            >
              Preview Review Workspace
            </div>

            <h1 style={{ margin: "0 0 8px 0", fontSize: "30px", lineHeight: 1.1 }}>
              Preview Manager
            </h1>

            <p style={{ margin: 0, color: "#64748b", maxWidth: "780px", lineHeight: 1.6 }}>
              Rename previews, assign them to fabric families or categories, approve the
              ones you want on the storefront, and choose which preview should be featured first.
            </p>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "18px",
              background: "#ffffff",
              padding: "16px",
              display: "grid",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700 }}>
              QUICK SUMMARY
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <div style={softCardStyle}>
                <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "4px" }}>
                  Total previews
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827" }}>
                  {previews.length}
                </div>
              </div>

              <div style={softCardStyle}>
                <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "4px" }}>
                  Approved previews
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827" }}>
                  {approvedCount}
                </div>
              </div>

              <div style={softCardStyle}>
                <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "4px" }}>
                  Featured previews
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827" }}>
                  {featuredCount}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "10px",
          }}
        >
          <button
            type="button"
            onClick={async () => {
              try {
                const selection = await (window as any).shopify.resourcePicker({
                  type: "product",
                  multiple: false,
                });

                const product = selection?.[0];
                if (!product) return;

                const pickedId = String(product.id || "").trim();

                if (!pickedId) {
                  setError("Missing product id");
                  return;
                }

                setError(null);
                setProductId(pickedId);
                await loadPreviews(pickedId);
              } catch (err) {
                console.error("Picker error:", err);
                setError("Could not open the product picker");
              }
            }}
            style={primaryButtonStyle}
          >
            Select product
          </button>
        </div>

        <div
          style={{
            marginTop: "16px",
            paddingTop: "16px",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "16px",
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: "8px",
                }}
              >
                CATEGORY / FAMILY OPTIONS
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Add category like Plush, Suede or Velvet"
                  style={{
                    ...inputStyle,
                    maxWidth: "320px",
                  }}
                />

                <button
                  type="button"
                  onClick={() => {
                    const trimmed = newCategory.trim();
                    if (!trimmed) return;

                    setManualCategories((prev) =>
                      prev.includes(trimmed) ? prev : [...prev, trimmed]
                    );
                    setNewCategory("");
                    setCategoryWarning(null);
                  }}
                  style={secondaryButtonStyle}
                >
                  Add category
                </button>
              </div>

              {categoryWarning && (
                <div
                  style={{
                    marginTop: "12px",
                    maxWidth: "700px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    background: "#fff7ed",
                    border: "1px solid #fed7aa",
                    color: "#9a3412",
                    fontSize: "13px",
                    lineHeight: 1.5,
                  }}
                >
                  {categoryWarning}
                </div>
              )}

              {categoryOptions.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    marginTop: "12px",
                  }}
                >
                  {categoryOptions.map((option) => {
                    const categoryIsUsed =
                      previews.some(
                        (preview) => (preview.fabricFamily || "").trim() === option.trim()
                      ) ||
                      Object.values(draftFamilies).some(
                        (value) => (value || "").trim() === option.trim()
                      );

                    return (
                      <div
                        key={option}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "6px 10px",
                          borderRadius: "999px",
                          fontSize: "12px",
                          fontWeight: 700,
                          background: "#f8fafc",
                          border: "1px solid #e5e7eb",
                          color: "#475569",
                        }}
                      >
                        <span>{option}</span>

                        <button
                          type="button"
                          onClick={() => removeCategory(option)}
                          title={
                            categoryIsUsed
                              ? "This category is still assigned to previews"
                              : "Remove category"
                          }
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: categoryIsUsed ? "#94a3b8" : "#dc2626",
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => loadPreviews()}
                style={secondaryButtonStyle}
              >
                Reload previews
              </button>
            </div>
          </div>
        </div>

        {productId && !loading && (
          <p style={{ marginTop: "12px", marginBottom: 0, fontSize: "13px", color: "#64748b" }}>
            Product selected. Previews should load automatically after selection.
          </p>
        )}
      </div>
      {loading && (
        <div style={{ ...softCardStyle, marginBottom: "18px" }}>
          Loading previews...
        </div>
      )}

      {error && (
        <div
          style={{
            ...softCardStyle,
            marginBottom: "18px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {loadedProduct && (
        <div style={{ ...cardStyle, marginBottom: "22px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)",
              gap: "16px",
              alignItems: "stretch",
            }}
          >
            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              {loadedProduct.imageUrl && (
                <img
                  src={loadedProduct.imageUrl}
                  alt={loadedProduct.title || "Product image"}
                  style={{
                    width: "96px",
                    height: "96px",
                    objectFit: "cover",
                    borderRadius: "14px",
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                  }}
                />
              )}

              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "6px" }}>
                  CURRENT PRODUCT
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827", marginBottom: "4px" }}>
                  {loadedProduct.title || "Untitled product"}
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                  {loadedProduct.shopifyProductId}
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.6 }}>
                  Manage categories, display names, approval status and storefront visibility
                  for this product’s generated previews.
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "16px",
                padding: "16px",
                background: "#f8fafc",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "#111827", marginBottom: "6px" }}>
                  Storefront visibility
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
                  Turn this on when you want the product and its approved previews available
                  in the customer-facing gallery block.
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <span style={getStatusPillStyle(!!loadedProduct.showOnStorefront)}>
                  <span>{loadedProduct.showOnStorefront ? "✓" : "○"}</span>
                  <span>
                    {loadedProduct.showOnStorefront ? "Visible on storefront" : "Hidden from storefront"}
                  </span>
                </span>

                <button
                  type="button"
                  disabled={storefrontSaving}
                  onClick={() => toggleProductStorefront(!loadedProduct.showOnStorefront)}
                  style={{
                    ...secondaryButtonStyle,
                    border: loadedProduct.showOnStorefront ? "1px solid #dc2626" : "1px solid #111827",
                    color: loadedProduct.showOnStorefront ? "#dc2626" : "#111827",
                  }}
                >
                  {storefrontSaving
                    ? "Saving..."
                    : loadedProduct.showOnStorefront
                    ? "Hide product"
                    : "Show product"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && loadedProduct && previews.length === 0 && (
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>No previews found</h2>
          <p style={{ marginBottom: 0, color: "#64748b" }}>
            This product does not have generated previews yet. Create previews in the Visualiser first.
          </p>
        </div>
      )}

      {Object.entries(grouped).map(([family, items]) => (
        <div key={family} style={{ marginBottom: "26px" }}>
          <div style={{ marginBottom: "12px" }}>
            <h2 style={{ margin: "0 0 6px 0", fontSize: "22px" }}>{family}</h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
              Review, rename, categorise, approve and feature these previews for storefront use.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 300px))",
              gap: "16px",
              justifyContent: "start",
            }}
          >
            {items.map((preview) => {
              const isApproved = preview.approvedForStorefront;
              const isFeatured = preview.featured;
              const isSaving = savingId === preview.id;
              const currentDraftName = draftNames[preview.id] ?? preview.colourName;
              const currentDraftFamily = draftFamilies[preview.id] ?? preview.fabricFamily ?? "";

              return (
                <div
                  key={preview.id}
                  style={{
                    ...cardStyle,
                    padding: "14px",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "1 / 1",
                      borderRadius: "14px",
                      overflow: "hidden",
                      background: "#f8fafc",
                      border: "1px solid #e5e7eb",
                      marginBottom: "12px",
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

                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "6px" }}>
                      DISPLAY NAME
                    </div>
                    <input
                      type="text"
                      value={currentDraftName}
                      onChange={(e) =>
                        setDraftNames((prev) => ({
                          ...prev,
                          [preview.id]: e.target.value,
                        }))
                      }
                      placeholder="Enter colour name"
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, marginBottom: "6px" }}>
                      FAMILY / CATEGORY
                    </div>

                    <select
                      value={currentDraftFamily}
                      onChange={(e) =>
                        setDraftFamilies((prev) => ({
                          ...prev,
                          [preview.id]: e.target.value,
                        }))
                      }
                      style={inputStyle}
                    >
                      <option value="">Select a category</option>
                      {categoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                      marginBottom: "12px",
                    }}
                  >
                    <span style={getStatusPillStyle(isApproved)}>
                      <span>{isApproved ? "✓" : "○"}</span>
                      <span>{isApproved ? "Approved" : "Not approved"}</span>
                    </span>

                    <span style={getStatusPillStyle(isFeatured, "blue")}>
                      <span>{isFeatured ? "★" : "☆"}</span>
                      <span>{isFeatured ? "Featured" : "Standard"}</span>
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "10px",
                      marginBottom: "10px",
                    }}
                  >
                    <button
                      type="button"
                      disabled={
                        isSaving ||
                        currentDraftName.trim() === "" ||
                        currentDraftFamily.trim() === ""
                      }
                      onClick={() =>
                        updatePreview(preview.id, {
                          colourName: currentDraftName.trim(),
                          fabricFamily: currentDraftFamily.trim(),
                        })
                      }
                      style={secondaryButtonStyle}
                    >
                      {isSaving ? "Saving..." : "Save details"}
                    </button>

                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        updatePreview(preview.id, {
                          approvedForStorefront: !preview.approvedForStorefront,
                        })
                      }
                      style={{
                        ...primaryButtonStyle,
                        background: isApproved ? "#ffffff" : "#111827",
                        color: isApproved ? "#111827" : "#ffffff",
                        border: isApproved ? "1px solid #d1d5db" : "1px solid #111827",
                      }}
                    >
                      {isSaving
                        ? "Saving..."
                        : isApproved
                        ? "Remove approval"
                        : "Approve"}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => toggleFeatured(preview)}
                    style={{
                      ...secondaryButtonStyle,
                      width: "100%",
                      border: isFeatured ? "1px solid #2563eb" : "1px solid #d1d5db",
                      color: isFeatured ? "#1d4ed8" : "#111827",
                    }}
                  >
                    {isSaving
                      ? "Saving..."
                      : isFeatured
                      ? "Remove featured status"
                      : "Set as featured"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}