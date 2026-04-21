import type { ActionFunction } from "react-router";

export const action: ActionFunction = async () => {
  // Billing is handled by Shopify Managed Pricing.
  // This route is kept as a placeholder.
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};