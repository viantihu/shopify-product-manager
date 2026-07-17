// app/routes/app._index.tsx
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listStagedAndApplied } from "../harness/decisions.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const decisions = await listStagedAndApplied();
  return { decisions };
}

export default function Index() {
  const { decisions } = useLoaderData<typeof loader>();
  const staged = decisions.filter((d) => d.status === "staged");
  const settled = decisions.filter((d) => d.status !== "staged");

  return (
    <s-page heading="Product completeness agent">
      <s-section heading={`Needs review (${staged.length})`}>
        {staged.length === 0 ? (
          <s-text>Nothing waiting for review.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {staged.map((d) => {
              const flagged =
                d.factCheck != null && JSON.parse(d.factCheck).factsPreserved === false;
              return (
                <s-stack key={d.id} direction="inline" gap="base" alignItems="center">
                  <s-badge>{d.recipe}</s-badge>
                  {flagged && <s-badge tone="critical">fabrication flagged</s-badge>}
                  <s-text>{d.agentReason}</s-text>
                  <Link to={`/app/decision/${d.id}`}>Review</Link>
                </s-stack>
              );
            })}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Recent agent activity">
        {settled.length === 0 ? (
          <s-text>No activity yet.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {settled.map((d) => (
              <s-stack key={d.id} direction="inline" gap="base" alignItems="center">
                <s-badge tone={d.status === "applied" ? "success" : "neutral"}>
                  {d.status}
                </s-badge>
                <s-text>{d.recipe}</s-text>
                <s-text color="subdued">{d.agentReason}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
