// app/routes/webhooks.products.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const numericId = (payload as { id?: number | string }).id;
  if (numericId != null) {
    const productId = String(numericId).startsWith("gid://")
      ? String(numericId)
      : `gid://shopify/Product/${numericId}`;
    await db.job.create({ data: { productId, shop, trigger: topic } });
  }

  return new Response(); // 200 immediately; the worker does the agent work
};
