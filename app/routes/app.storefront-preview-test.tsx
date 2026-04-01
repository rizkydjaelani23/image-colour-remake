import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type ProductInfo = {
  id: string;
  shopifyProductId: string;
  title: string | null;
  handle: string | null;
  imageUrl: string | null;
};

type StorefrontPreview = {
  id: string;
  fabricFamily: string;
  colourName: string;
  imageUrl: string;
  featured: boolean;
  status: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  return {
    shopDomain: session.shop,
  };
}

export default function StorefrontPreviewTestPage() {
  const { shopDomain } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [previews, setPreviews] = useState<StorefrontPreview[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<StorefrontPreview | null>(null);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const [showOriginalImage, setShowOriginalImage] = useState(false);

  async function loadStorefrontPreviews(forcedProductId?: string) {
    const idToUse = (forcedProductId ?? productId).trim();

    if (!idToUse) {
      setError("Missing product id");
      setProduct(null);
      setPreviews([]);
      setSelectedPreview(null);
      setActiveFamily(null);
      setShowOriginalImage(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/storefront-previews?shop=${encodeURIComponent(
          shopDomain,
        )}&productId=${encodeURIComponent(idToUse)}`
      );

      const rawText = await response.text();

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(rawText || "Server did not return valid JSON");
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to load storefront previews");
      }

      const nextProduct = data.product || null;
      const nextPreviews: StorefrontPreview[] = data.previews || [];
      const featuredPreview =
        nextPreviews.find((preview) => preview.featured) || nextPreviews[0] || null;

      const isSameProduct = idToUse === productId;

      setProduct(nextProduct);
      setPreviews(nextPreviews);

      if (!isSameProduct) {
        setSelectedPreview(featuredPreview);
        setActiveFamily(featuredPreview?.fabricFamily || null);
        setShowOriginalImage(false);
      } else {
        setSelectedPreview((currentSelected) => {
          if (showOriginalImage) {
            return currentSelected;
          }

          if (!currentSelected) {
            return featuredPreview;
          }

          const matchedPreview = nextPreviews.find(
            (preview) => preview.id === currentSelected.id
          );

          return matchedPreview || featuredPreview;
        });

        setActiveFamily((currentFamily) => {
          if (currentFamily && nextPreviews.some((preview) => preview.fabricFamily === currentFamily)) {
            return currentFamily;
          }

          return featuredPreview?.fabricFamily || null;
        });
      }
    } catch (err) {
      console.error("Load storefront previews error:", err);

      setProduct(null);
      setPreviews([]);
      setSelectedPreview(null);
      setActiveFamily(null);
      setShowOriginalImage(false);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load storefront previews");
      }
    } finally {
      setLoading(false);
    }
  }

  async function openProductPicker() {
    setError(null);

    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: false,
      });

      if (!selection || selection.length === 0) return;

      const pickedProduct = selection[0];
      const pickedId = String(pickedProduct.id || "").trim();

      if (!pickedId) {
        setError("Could not read product id from the picker.");
        return;
      }

      setProductId(pickedId);
      await loadStorefrontPreviews(pickedId);
    } catch (err) {
      console.error("Picker error:", err);
      setError("Could not open the product picker.");
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

  const visiblePreviews = activeFamily
    ? groupedFamilies[activeFamily] || []
    : previews;

  const isShowingOriginal = showOriginalImage || !selectedPreview;

  const mainImageUrl = isShowingOriginal
    ? product?.imageUrl || null
    : selectedPreview.imageUrl;

  const mainImageLabel = isShowingOriginal
    ? "Original product image"
    : selectedPreview.colourName;

  return (
    <div style={{ padding: "24px", maxWidth: "1500px", margin: "0 auto" }}>
      <div
        style={{
          marginBottom: "24px",
          padding: "20px",
          border: "1px solid #e5e7eb",
          borderRadius: "16px",
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        }}
      >
        <h1 style={{ margin: "0 0 8px 0", fontSize: "28px", fontWeight: 700 }}>
          Storefront Preview Test
        </h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: "14px", lineHeight: 1.6 }}>
          Test how approved previews will appear to customers on the storefront before
          pushing this layout live.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          marginBottom: "24px",
          flexWrap: "wrap",
          padding: "16px",
          border: "1px solid #e5e7eb",
          borderRadius: "16px",
          background: "#ffffff",
        }}
      >
        <button
          type="button"
          onClick={openProductPicker}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #111827",
            background: "#111827",
            color: "#ffffff",
            cursor: "pointer",
            font: "inherit",
            fontWeight: 600,
          }}
        >
          Select product
        </button>

        <button
          type="button"
          onClick={() => loadStorefrontPreviews()}
          disabled={!productId.trim()}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #d1d5db",
            background: !productId.trim() ? "#f3f4f6" : "#ffffff",
            color: !productId.trim() ? "#9ca3af" : "#111827",
            cursor: !productId.trim() ? "not-allowed" : "pointer",
            font: "inherit",
            fontWeight: 600,
          }}
        >
          Load storefront previews
        </button>

        <div style={{ minWidth: "240px", color: "#6b7280", fontSize: "13px" }}>
          {productId ? (
            <>
              <span style={{ fontWeight: 600, color: "#111827" }}>Selected product ID:</span>{" "}
              {productId}
            </>
          ) : (
            "No product selected yet"
          )}
        </div>
      </div>

      {loading && (
        <div
          style={{
            marginBottom: "20px",
            padding: "14px 16px",
            borderRadius: "12px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1d4ed8",
            fontWeight: 600,
          }}
        >
          Loading storefront previews...
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: "20px",
            padding: "14px 16px",
            borderRadius: "12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {product && (
        <div
          style={{
            marginBottom: "24px",
            padding: "18px",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            background: "#ffffff",
          }}
        >
          <p style={{ margin: "0 0 8px 0", fontWeight: 700, color: "#111827" }}>
            Current product
          </p>
          <p style={{ margin: "0 0 4px 0", fontSize: "18px", fontWeight: 600, color: "#111827" }}>
            {product.title || "Untitled product"}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>
            {product.shopifyProductId}
          </p>
        </div>
      )}

      {!loading && previews.length > 0 && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "18px",
            background: "#ffffff",
            padding: "20px",
          }}
        >
          <div style={{ marginBottom: "18px" }}>
            <h2 style={{ margin: "0 0 6px 0", fontSize: "22px", fontWeight: 700, color: "#111827" }}>
              See this product in other colours
            </h2>
            <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>
              Approved previews only. This is a test view of the customer-facing layout.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: "14px",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: "999px",
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                color: "#111827",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              Showing: {mainImageLabel}
            </span>

            <button
              type="button"
              onClick={() => setShowOriginalImage(true)}
              disabled={!product?.imageUrl}
              style={{
                padding: "8px 14px",
                borderRadius: "999px",
                border: showOriginalImage ? "1px solid #111827" : "1px solid #d1d5db",
                background: showOriginalImage ? "#111827" : "#ffffff",
                color: showOriginalImage ? "#ffffff" : "#111827",
                cursor: !product?.imageUrl ? "not-allowed" : "pointer",
                opacity: !product?.imageUrl ? 0.6 : 1,
                font: "inherit",
                fontWeight: 600,
              }}
            >
              Show original image
            </button>
          </div>

          {mainImageUrl && (
            <div
              style={{
                marginBottom: "20px",
                borderRadius: "16px",
                overflow: "hidden",
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
              }}
            >
              <img
                src={mainImageUrl}
                alt={mainImageLabel}
                style={{
                  width: "100%",
                  maxHeight: "580px",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
          )}

          {familyNames.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {familyNames.map((family) => (
                  <button
                    key={family}
                    type="button"
                    onClick={() => {
                      setActiveFamily(family);
                    }}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "999px",
                      border: activeFamily === family ? "1px solid #111827" : "1px solid #d1d5db",
                      background: activeFamily === family ? "#111827" : "#ffffff",
                      color: activeFamily === family ? "#ffffff" : "#111827",
                      cursor: "pointer",
                      font: "inherit",
                      fontWeight: 600,
                    }}
                  >
                    {family}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "14px",
            }}
          >
            {visiblePreviews.map((preview) => (
              <button
                key={preview.id}
                type="button"
                onClick={() => {
                  setSelectedPreview(preview);
                  setShowOriginalImage(false);
                }}
                style={{
                  border:
                    !showOriginalImage && selectedPreview?.id === preview.id
                      ? "2px solid #111827"
                      : "1px solid #d1d5db",
                  borderRadius: "14px",
                  background: "#ffffff",
                  padding: "10px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <img
                  src={preview.imageUrl}
                  alt={preview.colourName}
                  style={{
                    width: "100%",
                    borderRadius: "10px",
                    display: "block",
                    marginBottom: "8px",
                  }}
                />

                <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                  {preview.colourName}
                </div>

                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                  {preview.fabricFamily}
                  {preview.featured ? " • Featured" : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && previews.length === 0 && !error && (
        <div
          style={{
            padding: "18px",
            borderRadius: "16px",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            color: "#6b7280",
          }}
        >
          No approved storefront previews found for this product yet.
        </div>
      )}
    </div>
  );
}