// app/routes/app.decision.$id.tsx
import { useLoaderData, useFetcher, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDecision } from "../harness/decisions.server";
import * as writers from "../lib/product.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const decision = await getDecision(params.id!);
  if (!decision) throw new Response("Not found", { status: 404 });
  return { decision };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const verdict = String(form.get("verdict")); // agree | edit | reject
  const editedValue = form.get("editedValue");
  const decision = await getDecision(params.id!);
  if (!decision) throw new Response("Not found", { status: 404 });
  // Only staged decisions are actionable. A double-submit (back button, two
  // reviewers, refresh) must not re-write the product or re-stamp the verdict.
  if (decision.status !== "staged") return redirect("/app");

  let finalValue: string | null = null;
  let status = "rejected";

  if (verdict !== "reject") {
    finalValue =
      verdict === "edit" && editedValue != null
        ? String(editedValue)
        : decision.after;
    status = verdict === "edit" ? "edited" : "approved";

    // Write through the same field writers the gate uses.
    switch (decision.field) {
      case "descriptionHtml":
        await writers.writeDescription(admin.graphql, decision.productId, finalValue);
        break;
      case "productType":
        await writers.writeProductType(admin.graphql, decision.productId, finalValue);
        break;
      case "seo":
        await writers.writeSeo(admin.graphql, decision.productId, JSON.parse(finalValue));
        break;
      case "imageAltText": {
        const { mediaId, alt } = JSON.parse(finalValue);
        await writers.writeImageAlt(admin.graphql, decision.productId, mediaId, alt);
        break;
      }
    }
  }

  await db.decision.update({
    where: { id: decision.id },
    data: { status, reviewerVerdict: verdict, finalValue, reviewedAt: new Date() },
  });
  return redirect("/app");
}

export default function DecisionDetail() {
  const { decision } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isHtml = decision.field === "descriptionHtml";
  const factCheck = decision.factCheck
    ? (JSON.parse(decision.factCheck) as { factsPreserved: boolean; addedClaims: string[] })
    : null;

  return (
    <s-page heading={`Review: ${decision.recipe}`}>
      <s-section heading="Why the agent proposed this">
        <s-text>{decision.agentReason}</s-text>
        <s-text color="subdued">Gate: {decision.gateReason}</s-text>
      </s-section>

      {factCheck && (
        <s-section heading="Fact-check">
          {factCheck.factsPreserved ? (
            <s-text color="subdued">No added claims detected. The rewrite uses only facts from the original.</s-text>
          ) : (
            <s-stack direction="block" gap="base">
              <s-badge tone="critical">Fabrication flagged</s-badge>
              <s-text>
                The fact-check found claims in the rewrite that the original never
                states. Review each before approving; use edit to strip a claim
                and keep the rest.
              </s-text>
              {factCheck.addedClaims.map((claim, i) => (
                <s-text key={i}>• {claim}</s-text>
              ))}
            </s-stack>
          )}
        </s-section>
      )}

      <s-section heading="Before / after">
        <s-grid gridTemplateColumns="1fr 1fr" gap="large">
          <s-grid-item>
            <s-heading>Before</s-heading>
            {isHtml ? (
              <iframe title="before" sandbox="" srcDoc={decision.before ?? ""}
                style={{ width: "100%", minHeight: "200px", border: "1px solid #ddd" }} />
            ) : (
              <s-text>{decision.before ?? "(empty)"}</s-text>
            )}
          </s-grid-item>
          <s-grid-item>
            <s-heading>After</s-heading>
            {isHtml ? (
              <iframe title="after" sandbox="" srcDoc={decision.after}
                style={{ width: "100%", minHeight: "200px", border: "1px solid #ddd" }} />
            ) : (
              <s-text>{decision.after}</s-text>
            )}
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-section heading="Decide">
        <s-stack direction="inline" gap="base">
          <s-button onClick={() => fetcher.submit({ verdict: "agree" }, { method: "post" })}>
            Approve
          </s-button>
          <s-button variant="secondary"
            onClick={() => fetcher.submit({ verdict: "reject" }, { method: "post" })}>
            Reject
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
