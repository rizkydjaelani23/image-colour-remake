/**
 * /app/seo — Fabric SEO Engine dashboard
 *
 * Phase 3: Sync all products to SEO (metafields + tags)
 * Phase 4: Full fabric index table + Create collection pages
 */
import { useState, useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../utils/db.server";
import { getOrCreateShop } from "../utils/shop.server";
import { isSeoAddonActive } from "../utils/seo-addon.server";
import { colourToSlug, colourToCollectionHandle } from "../utils/colour";

// ── Types ─────────────────────────────────────────────────────────────────────

type FabricRow = {
  name:             string;
  fabricFamily:     string;
  productCount:     number;
  tag:              string;
  collectionHandle: string;
};

type GscMetrics = { clicks: number; impressions: number; position: number };
type GscDataMap = Record<string, GscMetrics>;

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop        = await getOrCreateShop(session.shop);
  const seoEnabled  = isSeoAddonActive(shop);

  if (!seoEnabled) {
    return {
      seoEnabled:       false,
      totalProducts:    0,
      approvedProducts: 0,
      shopDomain:       shop.shopDomain,
      fabrics:          [] as FabricRow[],
      gscConnected:     false,
      gscSiteUrl:       null,
      gscCacheAgeMin:   null,
      gscData:          {} as GscDataMap,
    };
  }

  // ── Stats counts ─────────────────────────────────────────────────────────
  const [totalProducts, approvedProducts] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.product.count({
      where: {
        shopId: shop.id,
        previews: { some: { approvedForStorefront: true, NOT: { status: "HIDDEN" } } },
      },
    }),
  ]);

  // ── Fabric index table data ───────────────────────────────────────────────
  // Fetch all approved previews and group by display-name in JS
  // (Prisma doesn't support COALESCE in groupBy natively)
  const allPreviews = await prisma.preview.findMany({
    where: {
      shopId:               shop.id,
      approvedForStorefront: true,
      NOT:                  { status: "HIDDEN" },
    },
    select: {
      colourName:          true,
      customerDisplayName: true,
      fabricFamily:        true,
      productId:           true,
    },
  });

  const fabricMap = new Map<string, { productIds: Set<string>; fabricFamily: string }>();
  for (const p of allPreviews) {
    const name = p.customerDisplayName || p.colourName;
    if (!fabricMap.has(name)) {
      fabricMap.set(name, { productIds: new Set(), fabricFamily: p.fabricFamily ?? "" });
    }
    fabricMap.get(name)!.productIds.add(p.productId);
  }

  const fabrics: FabricRow[] = [...fabricMap.entries()]
    .map(([name, { productIds, fabricFamily }]) => ({
      name,
      fabricFamily,
      productCount:     productIds.size,
      tag:              `fabric-${colourToSlug(name)}`,
      collectionHandle: colourToCollectionHandle(name),
    }))
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));

  // ── GSC connection ────────────────────────────────────────────────────────
  const gscConn = await prisma.gscConnection.findUnique({
    where:  { shopId: shop.id },
    select: { siteUrl: true, cachedData: true, cacheUpdatedAt: true },
  });

  const gscConnected    = !!gscConn;
  const gscSiteUrl      = gscConn?.siteUrl ?? null;
  const gscCacheAgeMin  = gscConn?.cacheUpdatedAt
    ? Math.round((Date.now() - gscConn.cacheUpdatedAt.getTime()) / 60_000)
    : null;
  const gscData: GscDataMap = gscConn?.cachedData
    ? (JSON.parse(gscConn.cachedData) as GscDataMap)
    : {};

  return {
    seoEnabled:       true,
    totalProducts,
    approvedProducts,
    shopDomain:       shop.shopDomain,
    fabrics,
    gscConnected,
    gscSiteUrl,
    gscCacheAgeMin,
    gscData,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function googleSearchUrl(colourName: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(colourName + " furniture")}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SeoPage() {
  const {
    seoEnabled, totalProducts, approvedProducts, shopDomain, fabrics,
    gscConnected, gscSiteUrl, gscCacheAgeMin, gscData: loaderGscData,
  } = useLoaderData<typeof loader>();

  // ── Sync state ───────────────────────────────────────────────────────────
  const [syncing, setSyncing]   = useState(false);
  const [syncResult, setSyncResult] = useState<{
    synced: number; tagsSynced: number; skipped: number; total: number;
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ── Collections state ─────────────────────────────────────────────────────
  const [creating, setCreating]         = useState(false);
  const [createResult, setCreateResult] = useState<{
    created: number; existing: number; failed: number;
  } | null>(null);
  const [createError, setCreateError]   = useState<string | null>(null);

  // ── Disable / cleanup state ───────────────────────────────────────────────
  const [disabling, setDisabling]       = useState(false);
  const [disableResult, setDisableResult] = useState<{
    clearedMetafields: number; clearedTags: number; deletedCollections: number;
  } | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);

  // ── GSC state ─────────────────────────────────────────────────────────────
  const [gscData, setGscData]           = useState<GscDataMap>(loaderGscData);
  const [gscRefreshing, setGscRefreshing] = useState(false);
  const [gscRefreshError, setGscRefreshError] = useState<string | null>(null);
  const [gscCacheAge, setGscCacheAge]   = useState<number | null>(gscCacheAgeMin);
  const [isConnected, setIsConnected]   = useState(gscConnected);

  // Listen for popup postMessage after OAuth callback closes
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if ((e.data as { gscConnected?: boolean })?.gscConnected) {
        // Reload to pick up the new GscConnection from loader
        window.location.reload();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ── Search filter ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");

  const filteredFabrics = fabrics.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.fabricFamily.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  async function runSync() {
    if (syncing) return;
    setSyncResult(null);
    setSyncError(null);
    setSyncing(true);
    try {
      const res  = await fetch("/api/seo-sync", { method: "POST" });
      const data = await res.json() as {
        ok?: boolean; synced?: number; tagsSynced?: number;
        skipped?: number; total?: number; error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Sync failed");
      setSyncResult({
        synced:     data.synced     ?? 0,
        tagsSynced: data.tagsSynced ?? 0,
        skipped:    data.skipped    ?? 0,
        total:      data.total      ?? 0,
      });
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "An unexpected error occurred");
    } finally {
      setSyncing(false);
    }
  }

  async function runCreateCollections() {
    if (creating) return;
    setCreateResult(null);
    setCreateError(null);
    setCreating(true);
    try {
      const res  = await fetch("/api/seo-create-collections", { method: "POST" });
      const data = await res.json() as {
        ok?: boolean; created?: number; existing?: number;
        failed?: number; error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Collection creation failed");
      setCreateResult({
        created:  data.created  ?? 0,
        existing: data.existing ?? 0,
        failed:   data.failed   ?? 0,
      });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "An unexpected error occurred");
    } finally {
      setCreating(false);
    }
  }

  function openGscConnect() {
    window.open(
      `/api/gsc-auth-start?shop=${encodeURIComponent(shopDomain)}`,
      "gsc_oauth",
      "width=600,height=700,left=200,top=100",
    );
  }

  async function refreshGscData() {
    if (gscRefreshing) return;
    setGscRefreshError(null);
    setGscRefreshing(true);
    try {
      const res  = await fetch("/api/gsc-refresh-data", { method: "POST" });
      const data = await res.json() as {
        ok?: boolean; fromCache?: boolean; cacheAgeMinutes?: number;
        data?: GscDataMap; error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Refresh failed");
      setGscData(data.data ?? {});
      setGscCacheAge(data.cacheAgeMinutes ?? 0);
    } catch (e) {
      setGscRefreshError(e instanceof Error ? e.message : "An unexpected error occurred");
    } finally {
      setGscRefreshing(false);
    }
  }

  async function disconnectGsc() {
    if (!window.confirm("Disconnect Google Search Console? GSC data will no longer show in the table.")) return;
    try {
      await fetch("/api/gsc-disconnect", { method: "POST" });
      setIsConnected(false);
      setGscData({});
      setGscCacheAge(null);
    } catch (e) {
      console.error("GSC disconnect error:", e);
    }
  }

  async function runDisable() {
    if (disabling) return;
    setDisableResult(null);
    setDisableError(null);
    setDisabling(true);
    try {
      const res  = await fetch("/api/seo-disable", { method: "POST" });
      const data = await res.json() as {
        ok?: boolean;
        clearedMetafields?: number;
        clearedTags?:       number;
        deletedCollections?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Cleanup failed");
      setDisableResult({
        clearedMetafields:  data.clearedMetafields  ?? 0,
        clearedTags:        data.clearedTags        ?? 0,
        deletedCollections: data.deletedCollections ?? 0,
      });
    } catch (e) {
      setDisableError(e instanceof Error ? e.message : "An unexpected error occurred");
    } finally {
      setDisabling(false);
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = {
    background:   "#fff",
    border:       "1px solid #e5e7eb",
    borderRadius: "16px",
    padding:      "24px 28px",
    marginBottom: "20px",
    boxShadow:    "0 1px 4px rgba(0,0,0,0.05)",
  };

  const statBox: React.CSSProperties = {
    background:   "#f8fafc",
    border:       "1px solid #e2e8f0",
    borderRadius: "12px",
    padding:      "16px 22px",
    flex:         1,
    minWidth:     "130px",
  };

  const primaryBtn = (disabled?: boolean): React.CSSProperties => ({
    background:    disabled ? "#e5e7eb" : "linear-gradient(135deg, #4f46e5, #7c3aed)",
    color:         disabled ? "#9ca3af" : "#fff",
    border:        "none",
    borderRadius:  "10px",
    padding:       "11px 22px",
    fontSize:      "13px",
    fontWeight:    700,
    cursor:        disabled ? "not-allowed" : "pointer",
    display:       "inline-flex",
    alignItems:    "center",
    gap:           "7px",
    transition:    "opacity 0.15s",
    opacity:       disabled ? 0.7 : 1,
    flexShrink:    0,
  });

  const secondaryBtn = (disabled?: boolean): React.CSSProperties => ({
    background:    disabled ? "#f9fafb" : "#fff",
    color:         disabled ? "#9ca3af" : "#374151",
    border:        `1px solid ${disabled ? "#e5e7eb" : "#d1d5db"}`,
    borderRadius:  "10px",
    padding:       "11px 22px",
    fontSize:      "13px",
    fontWeight:    700,
    cursor:        disabled ? "not-allowed" : "pointer",
    display:       "inline-flex",
    alignItems:    "center",
    gap:           "7px",
    transition:    "opacity 0.15s",
    opacity:       disabled ? 0.7 : 1,
    flexShrink:    0,
  });

  // ── Not active ────────────────────────────────────────────────────────────
  if (!seoEnabled) {
    return (
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={card}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
          <h2 style={{ margin: "0 0 10px", fontSize: "20px", fontWeight: 800, color: "#111827" }}>
            Fabric SEO Engine
          </h2>
          <p style={{ color: "#6b7280", fontSize: "14px", lineHeight: 1.6, margin: "0 0 20px" }}>
            The Fabric SEO Engine automatically writes your approved colour names to Shopify product
            metafields, tags products for automated collection pages, and renders SEO alt text on
            every gallery image — making each colour preview a permanent organic search asset.
          </p>
          <p style={{ color: "#6b7280", fontSize: "14px", lineHeight: 1.6, margin: 0 }}>
            Upgrade your plan to unlock the Fabric SEO Engine.
          </p>
        </div>
      </div>
    );
  }

  // ── Active ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <span style={{ fontSize: "30px" }}>🔍</span>
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: "#111827" }}>
            Fabric SEO Engine
          </h1>
          <span style={{
            background:    "linear-gradient(135deg, #4f46e5, #7c3aed)",
            color:         "#fff",
            fontSize:      "10px",
            fontWeight:    700,
            padding:       "3px 10px",
            borderRadius:  "20px",
            letterSpacing: "0.5px",
          }}>
            ACTIVE
          </span>
        </div>
        <p style={{ color: "#6b7280", fontSize: "13px", lineHeight: 1.6, margin: 0 }}>
          Every approved colour gets a product tag, a collection page, and SEO-optimised alt text —
          automatically. Use the tools below to catch up existing products and create collection pages.
        </p>
      </div>

      {/* ── Stats ── */}
      <div style={card}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <div style={statBox}>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#4f46e5" }}>
              {fabrics.length}
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px", fontWeight: 600 }}>
              Unique fabric colours
            </div>
          </div>
          <div style={statBox}>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#059669" }}>
              {approvedProducts}
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px", fontWeight: 600 }}>
              Products with approved colours
            </div>
          </div>
          <div style={statBox}>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#374151" }}>
              {totalProducts}
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px", fontWeight: 600 }}>
              Total products in app
            </div>
          </div>
          <div style={statBox}>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#0891b2" }}>
              ✓ Auto
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px", fontWeight: 600 }}>
              Syncs on every approval
            </div>
          </div>
        </div>
      </div>

      {/* ── Action row: Sync + Create collections ── */}
      <div style={{ ...card, padding: "20px 28px" }}>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" }}>

          {/* Sync all */}
          <div style={{ flex: 1, minWidth: "260px" }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "#111827", marginBottom: "4px" }}>
              Sync metafields &amp; tags
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.5, marginBottom: "12px" }}>
              Writes colour metafields and product tags for all{" "}
              <strong>{approvedProducts}</strong> products that have approved colours.
              Run this once for existing stock.
            </div>
            {syncResult && !syncing && (
              <div style={{
                background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px",
                padding: "10px 14px", marginBottom: "10px", fontSize: "12px", color: "#166534",
              }}>
                ✅ <strong>{syncResult.synced}</strong> metafields · <strong>{syncResult.tagsSynced}</strong> tag sets synced
                {syncResult.skipped > 0 && <> · {syncResult.skipped} skipped</>}
              </div>
            )}
            {syncError && !syncing && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
                padding: "10px 14px", marginBottom: "10px", fontSize: "12px", color: "#991b1b",
              }}>
                ❌ {syncError}
              </div>
            )}
            <button
              type="button"
              style={primaryBtn(syncing || approvedProducts === 0)}
              disabled={syncing || approvedProducts === 0}
              onClick={runSync}
            >
              {syncing ? "⏳ Syncing…" : "🔄 Sync all products"}
            </button>
          </div>

          <div style={{ width: "1px", background: "#f1f5f9", alignSelf: "stretch" }} />

          {/* Create collections */}
          <div style={{ flex: 1, minWidth: "260px" }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "#111827", marginBottom: "4px" }}>
              Create collection pages
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.5, marginBottom: "12px" }}>
              Creates a Shopify collection page for each of your{" "}
              <strong>{fabrics.length}</strong> fabric colours. Pages are live and
              indexed by Google but NOT added to store navigation unless you choose to.
            </div>
            {createResult && !creating && (
              <div style={{
                background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px",
                padding: "10px 14px", marginBottom: "10px", fontSize: "12px", color: "#166534",
              }}>
                ✅ <strong>{createResult.created}</strong> created
                {createResult.existing > 0 && <> · {createResult.existing} already existed</>}
                {createResult.failed > 0 && (
                  <span style={{ color: "#b91c1c" }}> · {createResult.failed} failed</span>
                )}
              </div>
            )}
            {createError && !creating && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
                padding: "10px 14px", marginBottom: "10px", fontSize: "12px", color: "#991b1b",
              }}>
                ❌ {createError}
              </div>
            )}
            <button
              type="button"
              style={secondaryBtn(creating || fabrics.length === 0)}
              disabled={creating || fabrics.length === 0}
              onClick={runCreateCollections}
            >
              {creating ? "⏳ Creating…" : "📄 Create collection pages"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Google Search Console ── */}
      <div style={{
        ...card,
        borderColor: isConnected ? "#a5b4fc" : "#e5e7eb",
        background:  isConnected ? "#faf5ff" : "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "20px" }}>📊</span>
              <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#374151" }}>
                Google Search Console
              </h2>
              {isConnected && (
                <span style={{
                  background: "#7c3aed", color: "#fff", fontSize: "10px",
                  fontWeight: 700, padding: "2px 8px", borderRadius: "20px",
                }}>
                  CONNECTED
                </span>
              )}
            </div>

            {isConnected ? (
              <>
                <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px", lineHeight: 1.5 }}>
                  Showing real clicks, impressions &amp; position for each fabric collection page
                  over the last 28 days.
                </p>
                {gscSiteUrl && (
                  <p style={{ fontSize: "11px", color: "#a78bfa", margin: "0 0 12px" }}>
                    📍 {gscSiteUrl}
                  </p>
                )}
                {gscCacheAge !== null && (
                  <p style={{ fontSize: "11px", color: "#9ca3af", margin: "0 0 12px" }}>
                    {gscCacheAge === 0
                      ? "Just refreshed"
                      : gscCacheAge < 60
                      ? `Data from ${gscCacheAge}m ago`
                      : `Data from ${Math.round(gscCacheAge / 60)}h ago`}
                    {" · refreshes every 6 hours"}
                  </p>
                )}
                {gscRefreshError && (
                  <div style={{
                    background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
                    padding: "8px 12px", marginBottom: "10px", fontSize: "12px", color: "#991b1b",
                  }}>
                    ❌ {gscRefreshError}
                  </div>
                )}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={gscRefreshing}
                    onClick={refreshGscData}
                    style={secondaryBtn(gscRefreshing)}
                  >
                    {gscRefreshing ? "⏳ Refreshing…" : "🔄 Refresh GSC data"}
                  </button>
                  <button
                    type="button"
                    onClick={disconnectGsc}
                    style={{
                      background: "none", color: "#9ca3af", border: "1px solid #e5e7eb",
                      borderRadius: "10px", padding: "11px 16px", fontSize: "12px",
                      fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 12px", lineHeight: 1.6 }}>
                  Connect your Google Search Console account to see real clicks, impressions, and
                  average ranking position for each fabric collection page — directly in the table below.
                </p>
                <button
                  type="button"
                  onClick={openGscConnect}
                  style={primaryBtn()}
                >
                  🔗 Connect Google Search Console
                </button>
              </>
            )}
          </div>

          {/* GSC summary stats — only shown when connected and data exists */}
          {isConnected && Object.keys(gscData).length > 0 && (() => {
            const totals = Object.values(gscData).reduce(
              (acc, d) => ({ clicks: acc.clicks + d.clicks, impressions: acc.impressions + d.impressions }),
              { clicks: 0, impressions: 0 },
            );
            return (
              <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
                <div style={{ ...statBox, minWidth: "100px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#7c3aed" }}>
                    {totals.clicks.toLocaleString()}
                  </div>
                  <div style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600 }}>
                    Total clicks (28d)
                  </div>
                </div>
                <div style={{ ...statBox, minWidth: "100px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#0891b2" }}>
                    {totals.impressions.toLocaleString()}
                  </div>
                  <div style={{ fontSize: "10px", color: "#6b7280", fontWeight: 600 }}>
                    Impressions (28d)
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Fabric Index Table ── */}
      <div style={card}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "12px", marginBottom: "16px", flexWrap: "wrap",
        }}>
          <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#374151" }}>
            Fabric Index — {fabrics.length} colour{fabrics.length !== 1 ? "s" : ""}
          </h2>
          {fabrics.length > 6 && (
            <input
              type="search"
              placeholder="Filter colours…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "7px 12px", borderRadius: "8px", border: "1px solid #d1d5db",
                fontSize: "13px", outline: "none", width: "180px",
              }}
            />
          )}
        </div>

        {fabrics.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "32px 16px",
            color: "#9ca3af", fontSize: "13px",
          }}>
            No approved colours yet. Approve some previews in Preview Manager first.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                  {[
                    "Colour", "Family", "Products", "Shopify tag", "Collection URL",
                    ...(isConnected ? ["Clicks (28d)", "Impressions", "Position"] : []),
                    "",
                  ].map((h) => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: "left", fontSize: "11px",
                      fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredFabrics.map((f, i) => (
                  <tr
                    key={f.name}
                    style={{
                      borderBottom: i < filteredFabrics.length - 1 ? "1px solid #f9fafb" : "none",
                      background:   i % 2 === 0 ? "#fff" : "#fafafa",
                    }}
                  >
                    {/* Colour swatch + name */}
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#111827" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                          width: "10px", height: "10px", borderRadius: "50%",
                          background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                          flexShrink: 0,
                        }} />
                        {f.name}
                      </div>
                    </td>

                    {/* Fabric family */}
                    <td style={{ padding: "10px 12px", color: "#6b7280" }}>
                      {f.fabricFamily || "—"}
                    </td>

                    {/* Product count */}
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{
                        background:   "#eff6ff",
                        color:        "#1d4ed8",
                        borderRadius: "6px",
                        padding:      "2px 8px",
                        fontWeight:   700,
                        fontSize:     "12px",
                      }}>
                        {f.productCount}
                      </span>
                    </td>

                    {/* Tag */}
                    <td style={{ padding: "10px 12px" }}>
                      <code style={{
                        background:   "#f1f5f9",
                        color:        "#374151",
                        borderRadius: "4px",
                        padding:      "2px 6px",
                        fontSize:     "11px",
                        whiteSpace:   "nowrap",
                      }}>
                        {f.tag}
                      </code>
                    </td>

                    {/* Collection URL */}
                    <td style={{ padding: "10px 12px" }}>
                      <a
                        href={`https://${shopDomain}/collections/${f.collectionHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color:          "#4f46e5",
                          fontSize:       "11px",
                          textDecoration: "none",
                          whiteSpace:     "nowrap",
                        }}
                        title={`/collections/${f.collectionHandle}`}
                      >
                        /collections/{f.collectionHandle} ↗
                      </a>
                    </td>

                    {/* GSC data cells */}
                    {isConnected && (() => {
                      const m = gscData[f.collectionHandle];
                      const numStyle: React.CSSProperties = {
                        padding: "10px 12px", fontWeight: 700,
                        fontSize: "13px", textAlign: "right" as const,
                      };
                      return (
                        <>
                          <td style={numStyle}>
                            {m ? (
                              <span style={{ color: m.clicks > 0 ? "#059669" : "#9ca3af" }}>
                                {m.clicks > 0 ? m.clicks.toLocaleString() : "—"}
                              </span>
                            ) : <span style={{ color: "#d1d5db" }}>—</span>}
                          </td>
                          <td style={numStyle}>
                            {m ? (
                              <span style={{ color: m.impressions > 0 ? "#0891b2" : "#9ca3af" }}>
                                {m.impressions > 0 ? m.impressions.toLocaleString() : "—"}
                              </span>
                            ) : <span style={{ color: "#d1d5db" }}>—</span>}
                          </td>
                          <td style={numStyle}>
                            {m && m.position > 0 ? (
                              <span style={{
                                color: m.position <= 3 ? "#059669"
                                     : m.position <= 10 ? "#d97706"
                                     : "#6b7280",
                              }}>
                                #{m.position}
                              </span>
                            ) : <span style={{ color: "#d1d5db" }}>—</span>}
                          </td>
                        </>
                      );
                    })()}

                    {/* Google search */}
                    <td style={{ padding: "10px 12px" }}>
                      <a
                        href={googleSearchUrl(f.name)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display:        "inline-flex",
                          alignItems:     "center",
                          gap:            "4px",
                          padding:        "5px 10px",
                          borderRadius:   "6px",
                          border:         "1px solid #d1d5db",
                          background:     "#fff",
                          color:          "#374151",
                          fontSize:       "11px",
                          fontWeight:     600,
                          textDecoration: "none",
                          whiteSpace:     "nowrap",
                        }}
                        title={`Search Google for "${f.name} furniture"`}
                      >
                        🔍 Search Google
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredFabrics.length === 0 && search && (
              <div style={{
                textAlign: "center", padding: "20px 16px",
                color: "#9ca3af", fontSize: "13px",
              }}>
                No colours match &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── How it works ── */}
      <div style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 700, color: "#374151" }}>
          How It Works
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {[
            {
              icon:  "🏷️",
              title: "Product tags",
              desc:  'Every approved colour adds a tag like "fabric-plush-blue" to that Shopify product. Tags are removed automatically if a colour is unapproved.',
            },
            {
              icon:  "📄",
              title: "Automated collection pages",
              desc:  'Each colour gets a collection page at /collections/fabric-plush-blue. Shopify automatically populates it with every product tagged for that colour. Google indexes these pages for fabric-specific searches.',
            },
            {
              icon:  "📦",
              title: "Metafield: power_your_house.fabric_colours",
              desc:  '"Available fabric colours: Silver Velvet, Plush Blue, Mink Chenille" is written to each product. Google reads this as keyword-rich product text.',
            },
            {
              icon:  "🖼️",
              title: "Gallery alt text",
              desc:  'Every colour swatch image renders as "Product Name in Colour Name" — the most direct signal Google uses to understand image content.',
            },
            {
              icon:  "🔗",
              title: "Hidden indexed link",
              desc:  'A visually-hidden link on each product page lists all colour names anchored to the product URL. Server-rendered — Google crawls it instantly.',
            },
          ].map((item) => (
            <div key={item.title} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "20px", flexShrink: 0 }}>{item.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#111827", marginBottom: "2px" }}>
                  {item.title}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.6 }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div style={{
        ...card,
        borderColor: "#fca5a5",
        background:  "#fff8f8",
        marginTop:   "8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <span style={{ fontSize: "20px" }}>⚠️</span>
          <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>
            Danger Zone — Disable SEO Engine
          </h2>
        </div>

        <p style={{ fontSize: "13px", color: "#6b7280", lineHeight: 1.6, margin: "0 0 8px" }}>
          This removes <strong>all</strong> Fabric SEO Engine data from your Shopify store:
        </p>
        <ul style={{
          fontSize: "13px", color: "#6b7280", lineHeight: 1.8,
          margin: "0 0 16px", paddingLeft: "22px",
        }}>
          <li>Deletes the <code>power_your_house.fabric_colours</code> metafield from every product</li>
          <li>Removes all <code>fabric-*</code> tags from every product</li>
          <li>Deletes all <code>fabric-*</code> automated collection pages</li>
        </ul>
        <p style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5, margin: "0 0 18px" }}>
          Your app data (approved colours, preview images) is <strong>not</strong> deleted —
          you can re-enable and run Sync again at any time. Run this before uninstalling the
          app so your store is left clean.
        </p>

        {disableResult && !disabling && (
          <div style={{
            background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px",
            padding: "10px 14px", marginBottom: "14px", fontSize: "12px", color: "#166534",
          }}>
            ✅ Done — <strong>{disableResult.clearedMetafields}</strong> metafields cleared ·{" "}
            <strong>{disableResult.clearedTags}</strong> products de-tagged ·{" "}
            <strong>{disableResult.deletedCollections}</strong> collection
            {disableResult.deletedCollections !== 1 ? "s" : ""} deleted
          </div>
        )}
        {disableError && !disabling && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
            padding: "10px 14px", marginBottom: "14px", fontSize: "12px", color: "#991b1b",
          }}>
            ❌ {disableError}
          </div>
        )}

        <button
          type="button"
          disabled={disabling}
          onClick={() => {
            if (!window.confirm(
              "Remove all Fabric SEO metafields, tags, and collection pages from Shopify?\n\n" +
              "Your app data is kept — you can sync again any time.",
            )) return;
            void runDisable();
          }}
          style={{
            background:   disabling ? "#fca5a5" : "#dc2626",
            color:        "#fff",
            border:       "none",
            borderRadius: "10px",
            padding:      "11px 22px",
            fontSize:     "13px",
            fontWeight:   700,
            cursor:       disabling ? "not-allowed" : "pointer",
            display:      "inline-flex",
            alignItems:   "center",
            gap:          "7px",
            opacity:      disabling ? 0.7 : 1,
            flexShrink:   0,
          }}
        >
          {disabling ? "⏳ Removing SEO data…" : "🗑️ Disable SEO & Clean Up"}
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
