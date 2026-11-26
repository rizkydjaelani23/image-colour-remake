/**
 * GET /api/egress-check — TEMPORARY.
 * Reports the public address this server uses for outgoing requests, so the
 * Shopify Dev Dashboard IP allowlist can be filled in. Remove once done.
 */
export async function loader() {
  const ipv4: string[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://api.ipify.org?format=json");
      const j = (await r.json()) as { ip?: string };
      if (j.ip) ipv4.push(j.ip);
    } catch { /* ignore */ }
  }
  let ipv6: string | null = null;
  try {
    const r = await fetch("https://api64.ipify.org?format=json");
    const j = (await r.json()) as { ip?: string };
    ipv6 = j.ip ?? null;
  } catch { /* ignore */ }

  return Response.json(
    { ipv4: [...new Set(ipv4)], ipv6, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
