import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { isFormattingLevel, DEFAULT_LEVEL } from "../lib/formatting-levels";
import { formatDescription } from "../lib/format-description.server";
import { getProduct, saveDraftAndReadBack } from "../lib/product.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const productId = String(form.get("productId") ?? "");

  if (!productId) {
    return { ok: false, error: "No product selected." };
  }

  if (intent === "format") {
    const levelRaw = String(form.get("level") ?? DEFAULT_LEVEL);
    const level = isFormattingLevel(levelRaw) ? levelRaw : DEFAULT_LEVEL;
    const product = await getProduct(admin.graphql, productId);
    const result = await formatDescription({
      description: product.descriptionHtml,
      context: product.context,
      level,
    });
    return { ok: true, intent, result };
  }

  if (intent === "save") {
    const formattedHtml = String(form.get("formattedHtml") ?? "");
    const readBack = await saveDraftAndReadBack(
      admin.graphql,
      productId,
      formattedHtml,
    );
    const roundTripped = readBack === formattedHtml;
    return { ok: true, intent, roundTripped };
  }

  return { ok: false, error: `Unknown intent: ${intent}` };
}
