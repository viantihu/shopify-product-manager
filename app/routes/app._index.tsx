// app/routes/app._index.tsx
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listStagedAndApplied } from "../harness/decisions.server";
import {
  fieldLabel,
  groupDecisionsByProduct,
  numericProductId,
  type ProductGroup,
} from "../lib/product-changes";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const decisions = await listStagedAndApplied();
  // The index is organized around the product that changed, not the recipe that
  // ran. Fold the flat decision list into per-product groups here so the
  // component just renders.
  return groupDecisionsByProduct(decisions);
}

function ProductTitle({ group }: { group: ProductGroup }) {
  // Deep-link the title into the Shopify admin when we have a usable id;
  // otherwise render plain text so we never emit a dead link.
  return group.adminUrl ? (
    <s-link href={group.adminUrl}>{group.productTitle}</s-link>
  ) : (
    <s-text type="strong">{group.productTitle}</s-text>
  );
}

export default function Index() {
  const { needsReview, updated } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Product completeness agent">
      <s-section heading={`Products needing review (${needsReview.length})`}>
        {needsReview.length === 0 ? (
          <s-text>Nothing waiting for review.</s-text>
        ) : (
          <s-stack direction="block" gap="large">
            {needsReview.map((group) => {
              // Review is now per product: one composed page for all of a
              // product's staged changes. Fall back to the per-decision deep
              // link only if the id can't form a product URL.
              const numericId = numericProductId(group.productId);
              const staged = group.changes.filter((c) => c.status === "staged");
              return (
                <s-stack key={group.productId} direction="block" gap="small-200">
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <ProductTitle group={group} />
                    {numericId && (
                      <Link to={`/app/product/${numericId}`}>Review product</Link>
                    )}
                  </s-stack>
                  {staged.map((c) => (
                    <s-stack key={c.id} direction="inline" gap="base" alignItems="center">
                      <s-badge>{fieldLabel(c.field)}</s-badge>
                      {c.flagged && <s-badge tone="critical">fabrication flagged</s-badge>}
                      <s-text color="subdued">{c.agentReason}</s-text>
                      {!numericId && <Link to={`/app/decision/${c.id}`}>Review</Link>}
                    </s-stack>
                  ))}
                </s-stack>
              );
            })}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Recently updated products">
        {updated.length === 0 ? (
          <s-text>No activity yet.</s-text>
        ) : (
          <s-stack direction="block" gap="large">
            {updated.map((group) => (
              <s-stack key={group.productId} direction="block" gap="small-200">
                <ProductTitle group={group} />
                {group.changes.map((c) => (
                  <s-stack key={c.id} direction="inline" gap="base" alignItems="center">
                    <s-badge tone={c.status === "applied" ? "success" : "neutral"}>
                      {c.status}
                    </s-badge>
                    <s-text>{fieldLabel(c.field)}</s-text>
                    <s-text color="subdued">{c.agentReason}</s-text>
                  </s-stack>
                ))}
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
