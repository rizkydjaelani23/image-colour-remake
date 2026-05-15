/**
 * GET /api/gsc-auth-start?shop=<shopDomain>
 *
 * Opens the Google OAuth 2.0 consent screen.
 * Called from a popup window opened by the SEO dashboard.
 *
 * This route is intentionally unauthenticated — it only builds a redirect URL
 * and sends the merchant to Google. The shop domain is passed as a query param
 * and encoded in the OAuth state so the callback can route the tokens correctly.
 *
 * To use: window.open('/api/gsc-auth-start?shop=' + shopDomain, '_blank', 'width=600,height=700')
 */
import type { LoaderFunctionArgs } from "react-router";
import { buildGscAuthUrl } from "../utils/gsc.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url  = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing ?shop= parameter", { status: 400 });
  }

  const authUrl = buildGscAuthUrl(shop);
  return Response.redirect(authUrl, 302);
}
