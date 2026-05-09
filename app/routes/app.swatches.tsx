import { useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";

type SwatchItem = {
  id: string;
  fabricFamily: string;
  colourName: string;
  imageUrl: string | null;
  previewCount: number;
};

type LoaderData = {
  swatches: SwatchItem[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const raw = await prisma.swatch.findMany({
    where: { shopId: shop.id },
    orderBy: [{ fabricFamily: "asc" }, { colourName: "asc" }],
    include: { _count: { select: { previews: true } } },
  });

  return {
    swatches: raw.map((s) => ({
      id: s.id,
      fabricFamily: s.fabricFamily,
      colourName: s.colourName,
      imageUrl: s.imageUrl ?? null,
      previewCount: s._count.previews,
    })),
  } satisfies LoaderData;
}

const pageStyle: CSSProperties = { padding: "24px", maxWidth: "1440px", margin: "0 auto" };

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "18px",
  background: "#ffffff",
  padding: "20px",
  boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
  marginBottom: "20px",
};

export default function SwatchLibraryPage() {
  const { swatches: initialSwatches } = useLoaderData<typeof loader>();
  const [swatches, setSwatches] = useState<SwatchItem[]>(initialSwatches);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Group by fabric family
  const filtered = swatches.filter(
    (s) =>
      !search.trim() ||
      s.colourName.toLowerCase().includes(search.toLowerCase()) ||
      s.fabricFamily.toLowerCase().includes(search.toLowerCase())
  );

  const grouped: Record<string, SwatchItem[]> = {};
  for (const s of filtered) {
    if (!grouped[s.fabricFamily]) grouped[s.fabricFamily] = [];
    grouped[s.fabricFamily].push(s);
  }

  async function deleteSwatch(swatch: SwatchItem) {
    const confirmed = window.confirm(
      swatch.previewCount > 0
        ? `Delete "${swatch.colourName}"? It is used by ${swatch.previewCount} preview${swatch.previewCount !== 1 ? "s" : ""} — those previews will keep their images but will no longer be linked to this swatch.`
        : `Delete "${swatch.colourName}"?`
    );
    if (!confirmed) return;

    setDeletingId(swatch.id);
    try {
      const formData = new FormData();
      formData.append("swatchId", swatch.id);

      const response = await fetch("/api/delete-swatch", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Failed to delete swatch");

      setSwatches((prev) => prev.filter((s) => s.id !== swatch.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete swatch");
    } finally {
      setDeletingId(null);
    }
  }

  const totalFamilies = Object.keys(grouped).length;

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: "0 0 6px 0", fontSize: "28px", fontWeight: 800, color: "#0f172a" }}>
          Swatch Library
        </h1>
        <p style={{ margin: 0, fontSize: "15px", color: "#64748b", lineHeight: 1.6 }}>
          Every fabric swatch you have ever used, organised by family. Delete unused swatches to keep the library clean — existing preview images are not affected.
        </p>
      </div>

      {/* Stats + search row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {[
            { label: "Total swatches", value: swatches.length },
            { label: "Fabric families", value: totalFamilies },
          ].map((stat) => (
            <div key={stat.label} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", background: "#fff", padding: "12px 18px" }}>
              <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700, marginBottom: "2px" }}>{stat.label.toUpperCase()}</div>
              <div style={{ fontSize: "24px", fontWeight: 900, color: "#0f172a" }}>{stat.value}</div>
            </div>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search swatches…"
          style={{
            padding: "10px 14px",
            borderRadius: "12px",
            border: "1px solid #d1d5db",
            font: "inherit",
            fontSize: "14px",
            width: "240px",
          }}
        />
      </div>

      {swatches.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>🧵</div>
          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>No swatches yet</div>
          <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6 }}>
            Swatches are saved automatically when you generate previews in the Visualiser.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "32px" }}>
          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>No matches for "{search}"</div>
          <div style={{ fontSize: "14px", color: "#64748b" }}>Try a different search term.</div>
        </div>
      ) : (
        Object.entries(grouped).map(([family, items]) => (
          <div key={family} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>
                📁 {family}
              </h2>
              <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "999px", background: "#f1f5f9", color: "#64748b", fontWeight: 700 }}>
                {items.length} {items.length === 1 ? "swatch" : "swatches"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
              {items.map((swatch) => {
                const isDeleting = deletingId === swatch.id;
                return (
                  <div
                    key={swatch.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "14px",
                      overflow: "hidden",
                      background: "#fff",
                      opacity: isDeleting ? 0.5 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {/* Swatch image */}
                    <div style={{ aspectRatio: "1 / 1", background: "#f8fafc" }}>
                      {swatch.imageUrl ? (
                        <img
                          src={swatch.imageUrl}
                          alt={swatch.colourName}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#cbd5e1", fontSize: "24px" }}>
                          🧵
                        </div>
                      )}
                    </div>

                    <div style={{ padding: "10px" }}>
                      <div style={{ fontWeight: 700, fontSize: "12px", color: "#0f172a", marginBottom: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {swatch.colourName}
                      </div>
                      <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "8px" }}>
                        {swatch.previewCount > 0
                          ? `${swatch.previewCount} preview${swatch.previewCount !== 1 ? "s" : ""}`
                          : "Unused"}
                      </div>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => deleteSwatch(swatch)}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          borderRadius: "8px",
                          border: "1px solid #fecaca",
                          background: "#fff",
                          color: "#dc2626",
                          cursor: isDeleting ? "not-allowed" : "pointer",
                          font: "inherit",
                          fontWeight: 700,
                          fontSize: "12px",
                        }}
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
