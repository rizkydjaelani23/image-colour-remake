import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import en from "@shopify/polaris/locales/en.json";
import { login } from "../../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const errors = await login(request);
  return { errors };
}

export default function AuthLogin() {
  const { apiKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <AppProvider>
      <div style={{ padding: "24px", maxWidth: "420px" }}>
        <h1>Log in</h1>

        <Form method="post">
          <input
            type="text"
            name="shop"
            placeholder="your-store.myshopify.com"
          />
          <button type="submit">Log in</button>
        </Form>

        {actionData?.errors && (
          <p style={{ color: "red" }}>Login failed</p>
        )}
      </div>
    </AppProvider>
  );
}