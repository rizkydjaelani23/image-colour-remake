import type { ActionFunction } from "react-router";
import { authenticate } from "../shopify.server";

export const action: ActionFunction = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    // First, find the active subscription ID
    const subResponse = await admin.graphql(`
      {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
          }
        }
      }
    `);

    const subData = await subResponse.json();
    const subs =
      subData?.data?.currentAppInstallation?.activeSubscriptions || [];

    const activeSub = subs.find(
      (s: { status: string }) => s.status === "ACTIVE",
    );

    if (!activeSub) {
      return Response.json(
        { error: "No active subscription found. You are already on the Free plan." },
        { status: 400 },
      );
    }

    // Cancel the subscription
    const cancelResponse = await admin.graphql(
      `mutation AppSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          id: activeSub.id,
        },
      },
    );

    const cancelData = await cancelResponse.json();
    const userErrors =
      cancelData?.data?.appSubscriptionCancel?.userErrors || [];

    if (userErrors.length > 0) {
      return Response.json(
        { error: userErrors.map((e: { message: string }) => e.message).join(", ") },
        { status: 400 },
      );
    }

    return Response.json({ ok: true, message: "Subscription cancelled. You are now on the Free plan." });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    return Response.json(
      { error: "Failed to cancel subscription. Please try again." },
      { status: 500 },
    );
  }
};