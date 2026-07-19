import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type PickerCollection = { id: string; title: string; count: number | null };
type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";
type Product = { id: string; title: string; status: ProductStatus; image: string | null };
type LoaderData = { collections: PickerCollection[] };

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const collections: PickerCollection[] = [];
  try {
    let cursor: string | null = null, hasNextPage = true;
    while (hasNextPage) {
      const res = await admin.graphql(
        `query ($cursor: String) {
          collections(first: 250, after: $cursor, sortKey: TITLE) {
            pageInfo { hasNextPage endCursor }
            edges { node { id title productsCount { count } } }
          }
        }`,
        { variables: { cursor } },
      );
      const json = await res.json() as {
        data?: { collections?: { pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges?: Array<{ node: { id: string; title: string; productsCount: { count: number } | null } }> } };
      };
      const page = json.data?.collections;
      if (!page) break;
      for (const e of page.edges ?? []) collections.push({ id: e.node.id, title: e.node.title, count: e.node.productsCount?.count ?? null });
      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor ?? null;
    }
  } catch (e) { console.error("add-colours collections load failed:", e); }
  return { collections } satisfies LoaderData;
}

const page: CSSProperties = { padding: "24px", maxWidth: "1000px", margin: "0 auto", background: "#f1f5f9", minHeight: "100vh" };
const card: CSSProperties = { border: "1px solid #e5e7eb", borderRadius: "18px", background: "#fff", padding: "22px", marginBottom: "16px", boxShadow: "0 2px 12px rgba(15,23,42,0.05)" };
const label: CSSProperties = { fontSize: "12px", fontWeight: 800, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" };
const input: CSSProperties = { padding: "9px 12px", borderRadius: "10px", border: "1px solid #d1d5db", font: "inherit", fontSize: "14px", boxSizing: "border-box" };

const MAX_COLOURS = 3;

export default function AddColoursPage() {
  const { collections } = useLoaderData<typeof loader>();

  const [family, setFamily] = useState("");
  const [colours, setColours] = useState<Array<{ name: string; file: File | null; preview: string | null }>>([
    { name: "", file: null, preview: null },
  ]);

  const [collectionId, setCollectionId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | { queued: number; skippedNoMask: string[]; skippedOverLimit: number; remaining: number }>(null);
  const [error, setError] = useState<string | null>(null);

  function setColour(i: number, patch: Partial<{ name: string; file: File | null; preview: string | null }>) {
    setColours((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addColour() { if (colours.length < MAX_COLOURS) setColours((p) => [...p, { name: "", file: null, preview: null }]); }
  function removeColour(i: number) { setColours((p) => p.filter((_, idx) => idx !== i)); }

  async function loadProducts(value: string) {
    setCollectionId(value);
    setProducts([]); setSelected(new Set());
    if (!value) return;
    setProductsLoading(true);
    try {
      const url = value === "ALL" ? "/api/visualiser-products?all=1" : `/api/visualiser-products?collectionId=${encodeURIComponent(value)}`;
      const res = await fetch(url);
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch { setProducts([]); } finally { setProductsLoading(false); }
  }

  function toggleProduct(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() { setSelected(new Set(products.map((p) => p.id))); }
  function clearAll() { setSelected(new Set()); }

  const readyColours = colours.filter((c) => c.name.trim() && c.file);
  const total = selected.size * readyColours.length;
  const canSubmit = family.trim() && readyColours.length > 0 && selected.size > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("fabricFamily", family.trim());
      fd.append("productIds", JSON.stringify([...selected]));
      fd.append("colourNames", JSON.stringify(readyColours.map((c) => c.name.trim())));
      readyColours.forEach((c, i) => c.file && fd.append(`swatch_${i}`, c.file));
      const res = await fetch("/api/bulk-add-colours", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProducts = useMemo(() => products.filter((p) => selected.has(p.id)), [products, selected]);

  return (
    <div style={page}>
      <div style={{ marginBottom: "22px" }}>
        <div style={{ display: "inline-flex", padding: "4px 12px", borderRadius: "999px", background: "#eef2ff", color: "#4338ca", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "10px" }}>
          🎨 Bulk colours
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: 900, color: "#0f172a" }}>Add colours to products</h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: "15px", lineHeight: 1.6, maxWidth: "70ch" }}>
          Add new colours to a fabric family and render them across many products at once — each product uses its most-recent saved mask. No re-rendering one by one.
        </p>
      </div>

      {result ? (
        <div style={card}>
          <div style={{ fontSize: "18px", fontWeight: 800, color: "#065f46", marginBottom: "8px" }}>✓ Queued {result.queued} render{result.queued === 1 ? "" : "s"}</div>
          <p style={{ margin: "0 0 6px", color: "#475569", fontSize: "14px", lineHeight: 1.6 }}>
            They’re rendering in the background and will appear as drafts in the Preview Manager, ready to approve for the storefront.
          </p>
          {result.skippedOverLimit > 0 && (
            <p style={{ margin: "0 0 6px", color: "#92400e", fontSize: "14px" }}>
              ⚠ {result.skippedOverLimit} skipped — they’d exceed this cycle’s preview allowance (you had {result.remaining} left). Upgrade or run the rest next cycle.
            </p>
          )}
          {result.skippedNoMask.length > 0 && (
            <p style={{ margin: "0 0 6px", color: "#92400e", fontSize: "14px" }}>
              ⚠ {result.skippedNoMask.length} product{result.skippedNoMask.length === 1 ? "" : "s"} skipped — no saved mask yet: {result.skippedNoMask.slice(0, 8).join(", ")}{result.skippedNoMask.length > 8 ? "…" : ""}
            </p>
          )}
          <button type="button" onClick={() => { setResult(null); setSelected(new Set()); }}
            style={{ marginTop: "10px", padding: "9px 18px", borderRadius: "10px", border: "none", background: "#4338ca", color: "#fff", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
            Add more colours
          </button>
        </div>
      ) : (
        <>
          {/* Step 1: family */}
          <div style={card}>
            <div style={label}>1 · Fabric family</div>
            <input style={{ ...input, width: "100%", maxWidth: "360px" }} placeholder="e.g. Plush" value={family} onChange={(e) => setFamily(e.target.value)} />
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#94a3b8" }}>Use an existing family name to add to it, or a new name to start one.</p>
          </div>

          {/* Step 2: colours */}
          <div style={card}>
            <div style={label}>2 · New colours ({colours.length}/{MAX_COLOURS})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {colours.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ width: 46, height: 46, borderRadius: "8px", overflow: "hidden", background: "#f1f5f9", border: "1px solid #e5e7eb", flexShrink: 0 }}>
                    {c.preview && <img src={c.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  </div>
                  <input style={{ ...input, flex: "1 1 180px" }} placeholder="Colour name (e.g. Silver Grey)" value={c.name} onChange={(e) => setColour(i, { name: e.target.value })} />
                  <label style={{ ...input, cursor: "pointer", color: "#4338ca", fontWeight: 600, background: "#f8faff", border: "1px solid #c7d2fe" }}>
                    {c.file ? "Change swatch" : "Upload swatch"}
                    <input type="file" accept="image/*" style={{ display: "none" }}
                      onChange={(e) => { const f = e.target.files?.[0] ?? null; setColour(i, { file: f, preview: f ? URL.createObjectURL(f) : null }); }} />
                  </label>
                  {colours.length > 1 && (
                    <button type="button" onClick={() => removeColour(i)} style={{ border: "1px solid #fecaca", background: "#fff", color: "#dc2626", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}>Remove</button>
                  )}
                </div>
              ))}
            </div>
            {colours.length < MAX_COLOURS && (
              <button type="button" onClick={addColour} style={{ marginTop: "12px", border: "1px dashed #c7d2fe", background: "#f8faff", color: "#4338ca", borderRadius: "10px", padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}>+ Add another colour</button>
            )}
          </div>

          {/* Step 3: products */}
          <div style={card}>
            <div style={label}>3 · Products</div>
            <select value={collectionId} onChange={(e) => loadProducts(e.target.value)} style={{ ...input, width: "100%", maxWidth: "420px", cursor: "pointer" }}>
              <option value="">— Choose a collection to load its products —</option>
              <option value="ALL">All products (slower)</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.title}{c.count != null ? ` (${c.count})` : ""}</option>)}
            </select>

            {collectionId && (
              <div style={{ marginTop: "14px" }}>
                {productsLoading ? (
                  <p style={{ color: "#6b7280", fontSize: "14px" }}>Loading products…</p>
                ) : products.length === 0 ? (
                  <p style={{ color: "#9ca3af", fontSize: "14px" }}>No products in this collection.</p>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
                      <button type="button" onClick={selectAll} style={{ border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", borderRadius: "8px", padding: "5px 12px", fontWeight: 700, cursor: "pointer", fontSize: "12px" }}>Select all ({products.length})</button>
                      {selected.size > 0 && <button type="button" onClick={clearAll} style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#475569", borderRadius: "8px", padding: "5px 12px", fontWeight: 600, cursor: "pointer", fontSize: "12px" }}>Clear</button>}
                      <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 600 }}>{selected.size} selected</span>
                    </div>
                    <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "12px" }}>
                      {products.map((p) => {
                        const on = selected.has(p.id);
                        return (
                          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: on ? "#f5f7ff" : "#fff" }}>
                            <input type="checkbox" checked={on} onChange={() => toggleProduct(p.id)} />
                            {p.image ? <img src={p.image} alt="" width={30} height={30} style={{ borderRadius: "6px", objectFit: "cover", border: "1px solid #e5e7eb" }} /> : <div style={{ width: 30, height: 30, borderRadius: "6px", background: "#f1f5f9" }} />}
                            <span style={{ fontSize: "13px", color: "#111", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                            <span style={{ fontSize: "11px", color: "#94a3b8" }}>{p.status.toLowerCase()}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <div style={{ ...card, position: "sticky", bottom: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "14px", color: "#475569" }}>
              {total > 0
                ? <><strong style={{ color: "#0f172a" }}>{total}</strong> preview{total === 1 ? "" : "s"} — {selected.size} product{selected.size === 1 ? "" : "s"} × {readyColours.length} colour{readyColours.length === 1 ? "" : "s"}</>
                : "Add colours with a swatch, then pick products to see the total."}
            </div>
            <button type="button" onClick={submit} disabled={!canSubmit}
              style={{ padding: "12px 26px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "15px", cursor: canSubmit ? "pointer" : "not-allowed", background: canSubmit ? "#4338ca" : "#cbd5e1", color: "#fff" }}>
              {submitting ? "Queuing…" : "Generate previews"}
            </button>
          </div>
          {error && <div style={{ ...card, color: "#dc2626", fontSize: "14px", fontWeight: 600 }}>{error}</div>}
        </>
      )}
    </div>
  );
}
