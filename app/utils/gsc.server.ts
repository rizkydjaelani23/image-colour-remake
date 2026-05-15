/**
 * Google Search Console — OAuth2 + Search Analytics utility
 *
 * Flow:
 *   1. buildGscAuthUrl(shopDomain)  → redirect merchant to Google OAuth
 *   2. exchangeCodeForTokens(code)  → swap auth code for access + refresh tokens
 *   3. listGscSites(accessToken)    → find the site that matches their shop
 *   4. queryGscUrlData(...)         → get clicks / impressions / position per URL
 *   5. refreshAccessToken(...)      → keep access token fresh (1h expiry)
 *
 * Env vars required:
 *   GOOGLE_CLIENT_ID      — from Google Cloud Console OAuth 2.0 credentials
 *   GOOGLE_CLIENT_SECRET  — same
 *   APP_URL               — e.g. https://image-colour-remake-production.up.railway.app
 *                           (registered as an authorised redirect URI in Cloud Console)
 */

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const APP_URL       =
  process.env.APP_URL ??
  "https://image-colour-remake-production.up.railway.app";

export const GSC_REDIRECT_URI = `${APP_URL}/api/gsc-auth-callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ── OAuth URL ─────────────────────────────────────────────────────────────────

/**
 * Build the Google OAuth 2.0 authorisation URL.
 * The shop domain is encoded in the state so the callback knows where to store tokens.
 */
export function buildGscAuthUrl(shopDomain: string): string {
  const state = Buffer.from(
    JSON.stringify({ shop: shopDomain, ts: Date.now() }),
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  GSC_REDIRECT_URI,
    response_type: "code",
    scope:         SCOPES.join(" "),
    access_type:   "offline",
    prompt:        "consent", // always re-request so we always get a refresh_token
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Decode the state parameter from the OAuth callback URL. */
export function decodeGscState(state: string): { shop: string; ts: number } | null {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf-8")) as {
      shop: string;
      ts:   number;
    };
  } catch {
    return null;
  }
}

// ── Token exchange ────────────────────────────────────────────────────────────

type RawTokenResponse = {
  access_token:   string;
  refresh_token?: string;
  expires_in:     number;
  token_type:     string;
  error?:         string;
  error_description?: string;
};

/** Exchange the one-time authorisation code for access + refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<RawTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  GSC_REDIRECT_URI,
      grant_type:    "authorization_code",
    }),
  });

  const data = await res.json() as RawTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `Token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  return data;
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    "refresh_token",
    }),
  });

  const data = await res.json() as RawTokenResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `Token refresh failed: ${data.error_description ?? data.error ?? res.status}`,
    );
  }

  return {
    accessToken: data.access_token,
    expiresAt:   new Date(Date.now() + data.expires_in * 1000),
  };
}

// ── Site list ─────────────────────────────────────────────────────────────────

export type GscSite = {
  siteUrl:         string;
  permissionLevel: string;
};

/** List all sites the merchant has verified in Google Search Console. */
export async function listGscSites(accessToken: string): Promise<GscSite[]> {
  const res = await fetch(
    "https://searchconsole.googleapis.com/webmasters/v3/sites",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    throw new Error(`GSC site list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { siteEntry?: GscSite[] };
  return data.siteEntry ?? [];
}

/**
 * Pick the best GSC site for a given shop domain.
 * Prefers an exact URL-prefix match, then a domain property, then falls back to
 * the first available site.
 */
export function pickBestSite(sites: GscSite[], shopDomain: string): string | null {
  if (sites.length === 0) return null;

  const domain = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // 1. Exact URL-prefix property: https://domain/
  const exact = sites.find(
    (s) => s.siteUrl === `https://${domain}/` || s.siteUrl === `https://www.${domain}/`,
  );
  if (exact) return exact.siteUrl;

  // 2. Domain property: sc-domain:domain
  const domProp = sites.find((s) => s.siteUrl === `sc-domain:${domain}`);
  if (domProp) return domProp.siteUrl;

  // 3. Any site containing the domain string
  const partial = sites.find((s) => s.siteUrl.includes(domain));
  if (partial) return partial.siteUrl;

  // 4. First site they have access to
  return sites[0].siteUrl;
}

// ── Search Analytics ──────────────────────────────────────────────────────────

export type GscUrlData = {
  clicks:      number;
  impressions: number;
  position:    number; // average ranking position (1 = top)
};

/**
 * Fetch search analytics data for a list of page URLs from Search Console.
 *
 * Strategy: fetch all rows for the site (last 28 days, page dimension) in a
 * single API call and filter to the URLs we care about client-side.
 * This avoids N individual requests for N fabric collection pages.
 *
 * Returns a Map<pageUrl, metrics>.
 */
export async function queryGscUrlData(
  accessToken: string,
  siteUrl:     string,
  pageUrls:    string[],
): Promise<Map<string, GscUrlData>> {
  const results = new Map<string, GscUrlData>();
  if (pageUrls.length === 0) return results;

  const urlSet   = new Set(pageUrls);
  const endDate  = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 28);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  try {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate:  fmt(startDate),
          endDate:    fmt(endDate),
          dimensions: ["page"],
          rowLimit:   5000,
        }),
      },
    );

    if (!res.ok) {
      console.error("GSC analytics query failed:", res.status, await res.text());
      return results;
    }

    const data = await res.json() as {
      rows?: Array<{
        keys:        string[];
        clicks:      number;
        impressions: number;
        position:    number;
      }>;
    };

    for (const row of data.rows ?? []) {
      const url = row.keys[0];
      if (!urlSet.has(url)) continue;
      results.set(url, {
        clicks:      Math.round(row.clicks),
        impressions: Math.round(row.impressions),
        position:    Math.round(row.position * 10) / 10,
      });
    }
  } catch (err) {
    console.error("GSC queryGscUrlData error:", err);
  }

  return results;
}
