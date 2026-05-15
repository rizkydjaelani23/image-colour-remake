/**
 * GET /api/gsc-auth-callback
 *
 * OAuth 2.0 callback from Google after the merchant grants Search Console access.
 *
 * Steps:
 *   1. Extract code + state from query params
 *   2. Decode state → shop domain
 *   3. Exchange auth code for access + refresh tokens
 *   4. List the merchant's verified GSC sites and pick the best match
 *   5. Upsert GscConnection record in DB
 *   6. Return a small HTML page that:
 *        a. Posts a "gscConnected" message to the opener window (SEO dashboard)
 *        b. Auto-closes after 2 s
 *
 * Authorised redirect URI that must be registered in Google Cloud Console:
 *   https://image-colour-remake-production.up.railway.app/api/gsc-auth-callback
 *
 * This route is intentionally NOT behind authenticate.admin — it's called by
 * Google's redirect, not from within the Shopify embedded app iframe.
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../utils/db.server";
import {
  decodeGscState,
  exchangeCodeForTokens,
  listGscSites,
  pickBestSite,
} from "../utils/gsc.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url   = new URL(request.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return callbackHtml(false, `Google declined access: ${error}`);
  }

  if (!code || !state) {
    return callbackHtml(false, "Missing code or state — please try connecting again.");
  }

  const decoded = decodeGscState(state);
  if (!decoded) {
    return callbackHtml(false, "Invalid state parameter — please try connecting again.");
  }

  const { shop } = decoded;

  try {
    // 1. Exchange auth code → tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
      return callbackHtml(
        false,
        "Google did not return a refresh token. Please go to " +
          "myaccount.google.com/permissions, revoke access for this app, and try again.",
      );
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // 2. Find the shop in our DB
    const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    if (!shopRecord) {
      return callbackHtml(false, `Shop "${shop}" not found in our database.`);
    }

    // 3. List GSC sites + pick best match
    const sites   = await listGscSites(tokens.access_token);
    const siteUrl = pickBestSite(sites, shop) ?? `https://${shop}/`;

    // 4. Upsert connection
    await prisma.gscConnection.upsert({
      where:  { shopId: shopRecord.id },
      create: {
        shopId:       shopRecord.id,
        siteUrl,
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
      update: {
        siteUrl,
        accessToken:    tokens.access_token,
        refreshToken:   tokens.refresh_token,
        expiresAt,
        cachedData:     null,
        cacheUpdatedAt: null,
      },
    });

    return callbackHtml(true, "", siteUrl);
  } catch (err) {
    console.error("api.gsc-auth-callback error:", err);
    return callbackHtml(false, err instanceof Error ? err.message : "Unknown error");
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function callbackHtml(ok: boolean, errorMsg: string, siteUrl?: string): Response {
  const html = ok ? successHtml(siteUrl ?? "") : failureHtml(errorMsg);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function successHtml(siteUrl: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Google Search Console — Connected</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; background: #f9fafb;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 44px 40px;
      text-align: center; max-width: 420px; width: 90%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon  { font-size: 52px; margin-bottom: 18px; }
    h2     { margin: 0 0 10px; color: #111827; font-size: 21px; font-weight: 800; }
    p      { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 20px; }
    .site  {
      background: #f0fdf4; border: 1px solid #bbf7d0;
      border-radius: 8px; padding: 9px 16px;
      font-size: 13px; color: #166534;
      margin-bottom: 24px; word-break: break-all;
    }
    .btn {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff; border: none; border-radius: 10px;
      padding: 12px 28px; font-size: 14px; font-weight: 700;
      cursor: pointer; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.88; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h2>Connected!</h2>
    <p>Your Google Search Console data will now appear in the Fabric SEO Engine dashboard.</p>
    ${siteUrl ? `<div class="site">📍 ${siteUrl}</div>` : ""}
    <button class="btn" onclick="notifyAndClose()">Done — Close Window</button>
  </div>
  <script>
    function notifyAndClose() {
      try { window.opener && window.opener.postMessage({ gscConnected: true }, '*'); } catch(e) {}
      window.close();
    }
    // Auto-close after 2s so merchants don't have to click
    setTimeout(notifyAndClose, 2000);
  </script>
</body>
</html>`;
}

function failureHtml(errorMsg: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Google Search Console — Connection Failed</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; background: #f9fafb;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 44px 40px;
      text-align: center; max-width: 420px; width: 90%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon  { font-size: 52px; margin-bottom: 18px; }
    h2     { margin: 0 0 10px; color: #111827; font-size: 21px; font-weight: 800; }
    .error {
      background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      padding: 10px 16px; font-size: 13px; color: #991b1b;
      margin-bottom: 24px; text-align: left; line-height: 1.5;
    }
    .btn {
      background: #6b7280; color: #fff; border: none; border-radius: 10px;
      padding: 12px 28px; font-size: 14px; font-weight: 700; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h2>Connection Failed</h2>
    <div class="error">${errorMsg}</div>
    <button class="btn" onclick="window.close()">Close Window</button>
  </div>
</body>
</html>`;
}
