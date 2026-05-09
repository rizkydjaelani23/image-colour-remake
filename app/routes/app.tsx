import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import en from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/visualiser">Visualiser</s-link>
        <s-link href="/app/previews">Preview Manager</s-link>
        <s-link href="/app/swatches">Swatch Library</s-link>
        <s-link href="/app/storefront-preview-test">Storefront Preview</s-link>
        <s-link href="/app/instructions">Instructions</s-link>
        <s-link href="/app/plans">Plans</s-link>
      </s-app-nav>

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
