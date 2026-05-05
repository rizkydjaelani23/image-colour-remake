import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getManagedPricingUrl } from "../utils/billing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { redirect, session } = await authenticate.admin(request);

  return redirect(getManagedPricingUrl(session.shop), {
    target: "_top",
  });
}

export default function ManagedPricingRedirect() {
  return null;
}
