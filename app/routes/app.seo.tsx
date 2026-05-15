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
import { getManagedPricingUrl } from "../utils/billing.server";
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
  const { session, admin } = await authenticate.admin(request);
  const shop               = await getOrCreateShop(session.shop);

  // ── SEO add-on gate ───────────────────────────────────────────────────────
  // Dev bypass: SEO_ADDON_DEV=true (scoped to SEO_ADDON_TEST_SHOP if set).
  // Production: check Shopify activeSubscriptions live so activation and
  // cancellation are reflected immediately without waiting for a webhook.
  let seoEnabled = false;

  if (process.env.SEO_ADDON_DEV === "true") {
    const testShop = process.env.SEO_ADDON_TEST_SHOP;
    if (!testShop || shop.shopDomain === testShop) seoEnabled = true;
  }

  if (!seoEnabled) {
    try {
      const subRes  = await admin.graphql(
        `{ currentAppInstallation { activeSubscriptions { name status } } }`,
      );
      const subJson = await subRes.json() as {
        data?: {
          currentAppInstallation?: {
            activeSubscriptions?: Array<{ name: string; status: string }>;
          };
        };
      };
      const subs = subJson?.data?.currentAppInstallation?.activeSubscriptions ?? [];
      seoEnabled   = subs.some(
        (s) =>
          (s.name === "Fabric SEO Engine" || s.name === "Pro + SEO Engine") &&
          s.status === "ACTIVE",
      );
      // Keep DB flag in sync so API route gates (seoAddonGate) reflect current state
      if (seoEnabled !== shop.seoAddonActive) {
        await prisma.shop.update({ where: { id: shop.id }, data: { seoAddonActive: seoEnabled } });
      }
    } catch {
      seoEnabled = shop.seoAddonActive; // fall back to last known DB state
    }
  }

  const managedPricingUrl = getManagedPricingUrl(session.shop);

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
      managedPricingUrl,
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
    managedPricingUrl,
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
    managedPricingUrl,
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
  const [createShowError, setCreateShowError] = useState(false);

  // ── Disable / cleanup state ───────────────────────────────────────────────
  const [disabling, setDisabling]       = useState(false);
  const [disableResult, setDisableResult] = useState<{
    clearedMetafields: number; clearedTags: number; deletedCollections: number;
  } | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);

  // ── Billing state (used by locked upgrade screen) ─────────────────────────
  const [activatingSeo, setActivatingSeo] = useState(false);

  // ── GSC state ─────────────────────────────────────────────────────────────
  const [gscData, setGscData]               = useState<GscDataMap>(loaderGscData);
  const [gscRefreshing, setGscRefreshing]   = useState(false);
  const [gscRefreshError, setGscRefreshError] = useState<string | null>(null);
  const [gscCacheAge, setGscCacheAge]       = useState<number | null>(gscCacheAgeMin);
  const [isConnected, setIsConnected]       = useState(gscConnected);
  const [currentSiteUrl, setCurrentSiteUrl] = useState<string | null>(gscSiteUrl);

  // Site picker state
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [sitePickerLoading, setSitePickerLoading] = useState(false);
  const [availableSites, setAvailableSites] = useState<{ siteUrl: string; permissionLevel: string }[]>([]);
  const [sitePickerError, setSitePickerError] = useState<string | null>(null);

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
        failed?: number; firstError?: string; error?: string;
        collections?: Array<{ colourName: string; error?: string }>;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Collection creation failed");
      // Surface the first failure reason so we can diagnose
      const firstError = data.collections?.find((c) => c.error)?.error ?? null;
      setCreateResult({
        created:  data.created  ?? 0,
        existing: data.existing ?? 0,
        failed:   data.failed   ?? 0,
      });
      if (firstError) setCreateError(`Shopify error: ${firstError}`);
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

  async function openSitePicker() {
    setShowSitePicker(true);
    setSitePickerError(null);
    setSitePickerLoading(true);
    try {
      const res  = await fetch("/api/gsc-sites");
      const data = await res.json() as {
        ok?: boolean;
        sites?: { siteUrl: string; permissionLevel: string }[];
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not load sites");
      setAvailableSites(data.sites ?? []);
    } catch (e) {
      setSitePickerError(e instanceof Error ? e.message : "Failed to load sites");
    } finally {
      setSitePickerLoading(false);
    }
  }

  async function selectSite(siteUrl: string) {
    try {
      await fetch("/api/gsc-select-site", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ siteUrl }),
      });
      setCurrentSiteUrl(siteUrl);
      setGscData({});
      setGscCacheAge(null);
      setShowSitePicker(false);
    } catch (e) {
      setSitePickerError(e instanceof Error ? e.message : "Failed to select site");
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

  function activateSeoAddon() {
    setActivatingSeo(true);
    // Send the merchant to Shopify's managed pricing page where the
    // "Fabric SEO Engine" plan is listed alongside Free / Pro.
    window.open(managedPricingUrl, "_top");
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

  // ── Not active — upgrade screen ───────────────────────────────────────────
  if (!seoEnabled) {
    return (
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <span style={{ fontSize: "28px" }}>🔍</span>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: "#111827" }}>
              Fabric SEO Engine
            </h1>
            <span style={{
              background: "#f1f5f9", color: "#64748b", fontSize: "10px",
              fontWeight: 700, padding: "3px 10px", borderRadius: "20px",
              letterSpacing: "0.5px",
            }}>
              NOT ACTIVE
            </span>
          </div>
          <p style={{ color: "#6b7280", fontSize: "13px", lineHeight: 1.6, margin: 0 }}>
            Turn every approved colour into a permanent Google search landing page — automatically.
          </p>
        </div>

        {/* Upgrade card */}
        <div style={{
          ...card,
          border: "2px solid #c7d2fe",
          background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 60%, #eef2ff 100%)",
        }}>
          <div style={{
            display: "inline-flex", alignSelf: "flex-start", padding: "4px 12px",
            borderRadius: "999px", background: "#eef2ff", border: "1px solid #c7d2fe",
            color: "#4338ca", fontSize: "11px", fontWeight: 700, marginBottom: "16px",
          }}>
            Available standalone or bundled with Pro
          </div>

          {/* Features */}
          <div style={{ marginBottom: "22px" }}>
            {[
              "One SEO collection page per fabric colour (e.g. /collections/fabric-plush-blue)",
              "Automated Shopify tags — products self-populate into each colour collection",
              "Colour keywords written to product metafields — Google reads these as rich search text",
              "SEO-optimised alt text on every colour preview image",
              "Google Search Console integration — see clicks & rankings per colour in one dashboard",
              "Fully automatic — every new approved colour is handled instantly, forever",
            ].map((feature) => (
              <div key={feature} style={{
                display: "flex", gap: "10px", marginBottom: "10px",
                fontSize: "13px", color: "#111827", alignItems: "flex-start",
              }}>
                <span style={{ color: "#4338ca", fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>✓</span>
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {/* Pricing options + CTA */}
          <div style={{ borderTop: "1px solid #e0e7ff", paddingTop: "20px" }}>

            {/* Two plan options */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>

              {/* SEO only */}
              <div style={{
                flex: 1, minWidth: "140px", padding: "14px 16px", borderRadius: "12px",
                border: "1px solid #c7d2fe", background: "#f8faff",
              }}>
                <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: 600, marginBottom: "6px" }}>
                  SEO Engine only
                </div>
                <div>
                  <span style={{ fontSize: "24px", fontWeight: 800, color: "#111827" }}>$14.99</span>
                  <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "4px" }}>/mo</span>
                </div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "3px" }}>
                  Add to your Free plan
                </div>
              </div>

              {/* Pro + SEO */}
              <div style={{
                flex: 1, minWidth: "140px", padding: "14px 16px", borderRadius: "12px",
                border: "2px solid #818cf8", background: "#eef2ff",
              }}>
                <div style={{ fontSize: "11px", color: "#4338ca", fontWeight: 700, marginBottom: "6px" }}>
                  ★ Pro + SEO Engine
                </div>
                <div>
                  <span style={{ fontSize: "24px", fontWeight: 800, color: "#111827" }}>$44.99</span>
                  <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "4px" }}>/mo</span>
                </div>
                <div style={{ fontSize: "11px", color: "#4338ca", fontWeight: 600, marginTop: "3px" }}>
                  Unlimited previews + SEO
                </div>
              </div>
            </div>

            {/* Button + note */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                Billed via Shopify · No contract · Cancel any time
              </div>
              <button
                type="button"
                disabled={activatingSeo}
                onClick={() => void activateSeoAddon()}
                style={{
                  background:   activatingSeo ? "#e0e7ff" : "linear-gradient(135deg, #4f46e5, #7c3aed)",
                  color:        activatingSeo ? "#6b7280" : "#fff",
                  border:       "none",
                  borderRadius: "12px",
                  padding:      "13px 26px",
                  fontSize:     "14px",
                  fontWeight:   700,
                  cursor:       activatingSeo ? "not-allowed" : "pointer",
                  boxShadow:    activatingSeo ? "none" : "0 4px 14px rgba(99,102,241,0.35)",
                  whiteSpace:   "nowrap" as const,
                  transition:   "opacity 0.15s",
                }}
              >
                {activatingSeo ? "⏳ Opening billing…" : "🔍 Choose a plan →"}
              </button>
            </div>
          </div>
        </div>

        {/* Realistic expectations note */}
        <div style={{
          ...card,
          background: "#fffbeb",
          border:     "1px solid #fde68a",
        }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
            ⏳ What to expect — read before you activate
          </div>
          <div style={{ fontSize: "13px", color: "#78350f", lineHeight: 1.8 }}>
            The SEO Engine makes your store <strong>correctly set up for organic search</strong> —
            it does not guarantee rankings or instant results. Google typically takes{" "}
            <strong>4–12 weeks</strong> to discover and index new collection pages.
            Results improve gradually over <strong>3–6 months</strong>.
            You won&apos;t rank for ultra-generic terms like &quot;sofa&quot; where major retailers dominate,
            but you can realistically rank for specific searches like{" "}
            <em>&quot;plush blue velvet 3-seater sofa&quot;</em>. The app handles all the technical
            groundwork — the pace of results depends on your domain&apos;s history and how many other
            websites link to yours.
          </div>
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
                background: createResult.failed > 0 ? "#fef2f2" : "#f0fdf4",
                border: `1px solid ${createResult.failed > 0 ? "#fecaca" : "#bbf7d0"}`,
                borderRadius: "8px", padding: "10px 14px", marginBottom: "10px",
                fontSize: "12px", color: createResult.failed > 0 ? "#991b1b" : "#166534",
              }}>
                {createResult.created > 0 && <>✅ <strong>{createResult.created}</strong> created · </>}
                {createResult.existing > 0 && <>{createResult.existing} already existed · </>}
                {createResult.failed > 0 && <strong>{createResult.failed} failed</strong>}
                {createError && (
                  <div style={{ marginTop: "6px", fontSize: "11px", opacity: 0.85 }}>
                    ↳ {createError}
                  </div>
                )}
              </div>
            )}
            {!createResult && createError && !creating && (
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
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                  {currentSiteUrl && (
                    <span style={{ fontSize: "11px", color: "#7c3aed", fontWeight: 600 }}>
                      📍 {currentSiteUrl}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={openSitePicker}
                    style={{
                      background: "none", border: "1px solid #c4b5fd", borderRadius: "6px",
                      padding: "2px 8px", fontSize: "11px", color: "#7c3aed",
                      cursor: "pointer", fontWeight: 600,
                    }}
                  >
                    {currentSiteUrl ? "Change site" : "Select site"}
                  </button>
                </div>

                {/* Site picker panel */}
                {showSitePicker && (
                  <div style={{
                    background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: "10px",
                    padding: "14px 16px", marginBottom: "12px",
                  }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#4c1d95", marginBottom: "10px" }}>
                      Select your Search Console property:
                    </div>
                    {sitePickerLoading && (
                      <div style={{ fontSize: "12px", color: "#7c3aed" }}>Loading sites…</div>
                    )}
                    {sitePickerError && (
                      <div style={{ fontSize: "12px", color: "#991b1b" }}>❌ {sitePickerError}</div>
                    )}
                    {!sitePickerLoading && availableSites.length === 0 && !sitePickerError && (
                      <div style={{ fontSize: "12px", color: "#6b7280" }}>No sites found in your GSC account.</div>
                    )}
                    {availableSites.map((site) => (
                      <button
                        key={site.siteUrl}
                        type="button"
                        onClick={() => void selectSite(site.siteUrl)}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          background: site.siteUrl === currentSiteUrl ? "#ede9fe" : "#fff",
                          border: `1px solid ${site.siteUrl === currentSiteUrl ? "#7c3aed" : "#e5e7eb"}`,
                          borderRadius: "8px", padding: "8px 12px", marginBottom: "6px",
                          fontSize: "12px", color: "#374151", cursor: "pointer", fontWeight: 500,
                        }}
                      >
                        {site.siteUrl === currentSiteUrl ? "✓ " : ""}{site.siteUrl}
                        <span style={{ fontSize: "10px", color: "#9ca3af", marginLeft: "8px" }}>
                          {site.permissionLevel}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowSitePicker(false)}
                      style={{
                        background: "none", border: "none", fontSize: "11px",
                        color: "#9ca3af", cursor: "pointer", marginTop: "4px",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
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

      {/* ── Realistic Expectations & FAQ ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
          <span style={{ fontSize: "20px" }}>📋</span>
          <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#374151" }}>
            Realistic Expectations &amp; FAQ
          </h2>
        </div>

        {/* What it does */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#111827", marginBottom: "10px", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
            ✅ What this app does for you
          </div>
          {[
            "Creates a dedicated Shopify collection page for every approved fabric colour — Google can index these pages for colour + product searches",
            "Tags each product automatically so Shopify populates those collection pages with the right products",
            "Writes all colour names into a product metafield so Google reads them as keyword-rich product text",
            "Sets descriptive alt text on every colour preview image (\"Product in Colour\" format)",
            "All of this happens automatically for every new colour you approve — no manual work needed",
          ].map((item) => (
            <div key={item} style={{ display: "flex", gap: "10px", marginBottom: "8px", fontSize: "13px", color: "#374151", alignItems: "flex-start" }}>
              <span style={{ color: "#059669", fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* What it can't do */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#111827", marginBottom: "10px", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
            ✗ What this app cannot do
          </div>
          {[
            "Guarantee you rank #1 for any keyword — no tool can promise this",
            "Build backlinks — links from other websites are the #1 ranking factor and cannot be created by software",
            "Override domain authority — a 10-year-old retailer with thousands of backlinks will outrank a new store on competitive terms, regardless of on-page SEO",
            "Make you rank for ultra-generic terms like \"sofa\" or \"bed\" — major retailers own these; your wins are specific searches like \"mink chenille corner sofa\"",
            "Control how fast Google crawls your site — new pages can take weeks to months to appear in results",
          ].map((item) => (
            <div key={item} style={{ display: "flex", gap: "10px", marginBottom: "8px", fontSize: "13px", color: "#374151", alignItems: "flex-start" }}>
              <span style={{ color: "#dc2626", fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>✗</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div style={{
          background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px",
          padding: "14px 18px", marginBottom: "22px",
        }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
            ⏳ Realistic timeline
          </div>
          {[
            { period: "Weeks 1–4", detail: "Google discovers and crawls your new collection pages. Faster if you submit your sitemap in Google Search Console (Settings → Sitemaps)." },
            { period: "Months 1–3", detail: "Pages begin appearing in Google's index. You'll see impressions in GSC above with near-zero clicks at first — this is normal." },
            { period: "Months 3–12", detail: "Positions gradually improve as Google gains confidence in your pages. Clicks increase for specific colour + product searches." },
            { period: "The honest truth", detail: "SEO is slow. This app ensures you're doing everything right technically — but results depend on your domain age, competition, and how many sites link to yours." },
          ].map(({ period, detail }) => (
            <div key={period} style={{ display: "flex", gap: "10px", marginBottom: "7px", fontSize: "12px", color: "#78350f", lineHeight: 1.6 }}>
              <span style={{ fontWeight: 700, flexShrink: 0, minWidth: "100px" }}>{period}:</span>
              <span>{detail}</span>
            </div>
          ))}
        </div>

        {/* What merchants can do themselves */}
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#111827", marginBottom: "12px", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
            🚀 What you can do yourself to speed up results
          </div>
          {[
            {
              title: "Submit your sitemap to Google Search Console",
              desc:  "In GSC → Sitemaps, add https://yourstore.com/sitemap.xml. This tells Google to crawl now instead of waiting for its next visit — the single most impactful thing you can do after creating collection pages.",
            },
            {
              title: "Write blog posts linking to your colour collections",
              desc:  "\"Our full range of Plush Blue furniture\" — link to /collections/fabric-plush-blue in the post body. A content page Google already trusts passing a link to your new collection gives it a significant ranking boost.",
            },
            {
              title: "Add collection pages to your store navigation",
              desc:  "Shopify Admin → Navigation → add your fabric collections to a menu. Every page on your site then passes link equity to the collection, telling Google these pages matter.",
            },
            {
              title: "Target specific searches, not generic ones",
              desc:  "You won't rank for \"sofa\" — but \"mink chenille 3-seater sofa UK\" or \"plush blue velvet bed frame\" are realistic first-page targets. Specific = less competition = achievable rankings.",
            },
            {
              title: "Get external links (press, directories, reviews)",
              desc:  "Every external website that links to your store improves your domain authority for everything. Encourage reviews on Trustpilot, Google, Houzz. Reach out to interior design blogs. Even one good link helps.",
            },
            {
              title: "Share collection pages on social media",
              desc:  "Organic social traffic is a signal Google uses to judge page quality. Share /collections/fabric-plush-blue when you post that colour on Instagram or Pinterest — the traffic counts.",
            },
          ].map((item) => (
            <div key={item.title} style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "flex-start" }}>
              <span style={{ color: "#4f46e5", fontWeight: 700, fontSize: "15px", flexShrink: 0, marginTop: "1px" }}>→</span>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "3px" }}>
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
