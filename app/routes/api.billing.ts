import type { ActionFunction } from "react-router";
import { authenticate } from "../shopify.server";

export const action: ActionFunction = async ({ request }) => {
  const { billing } = await authenticate.admin(request);

  const isTestBilling = process.env.NODE_ENV !== "production";

  const response = await billing.request({
    plan: "PRO_PLAN",
    isTest: isTestBilling,
    returnUrl: "/app",
  });

  const res = response as { confirmationUrl?: string };

  if (res.confirmationUrl) {
    return Response.redirect(res.confirmationUrl);
  }

  return Response.redirect("/app");
};