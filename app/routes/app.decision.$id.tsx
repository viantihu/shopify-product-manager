// app/routes/app.decision.$id.tsx
import { useState } from "react";
import { useLoaderData, useFetcher, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDecision } from "../harness/decisions.server";
import * as writers from "../lib/product.server";
import { parseEditable, serializeEditable, type EditDraft } from "../lib/decision-edit";

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

// The editable "After" — a plain-text editor seeded with the agent's
// suggestion. No HTML editing: the description is shown as plain text (blank
// lines separate paragraphs) and re-wrapped in <p> tags on save. Every field
// edits as text a non-technical reviewer can read and change directly.
function AfterEditor({
  draft,
  onChange,
}: {
  draft: EditDraft;
  onChange: (next: EditDraft) => void;
}) {
  if (draft.kind === "seo") {
    return (
      <s-stack direction="block" gap="base">
        <s-text-field
          label="SEO title"
          value={draft.title}
          onChange={(e) =>
            onChange({ ...draft, title: (e.target as HTMLInputElement).value })
          }
        />
        <s-text-area
          label="SEO description"
          rows={3}
          value={draft.description}
          onChange={(e) =>
            onChange({ ...draft, description: (e.target as HTMLTextAreaElement).value })
          }
        />
      </s-stack>
    );
  }
  if (draft.kind === "alt") {
    return (
      <s-text-field
        label="Image alt text"
        value={draft.alt}
        onChange={(e) => onChange({ ...draft, alt: (e.target as HTMLInputElement).value })}
      />
    );
  }
  if (draft.kind === "html") {
    return (
      <s-text-area
        label={draft.label}
        rows={10}
        value={draft.value}
        onChange={(e) => onChange({ ...draft, value: (e.target as HTMLTextAreaElement).value })}
      />
    );
  }
  return (
    <s-text-field
      label={draft.label}
      value={draft.value}
      onChange={(e) => onChange({ ...draft, value: (e.target as HTMLInputElement).value })}
    />
  );
}

export default function DecisionDetail() {
  const { decision } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isHtml = decision.field === "descriptionHtml";
  const factCheck = decision.factCheck
    ? (JSON.parse(decision.factCheck) as { factsPreserved: boolean; addedClaims: string[] })
    : null;

  // Seed the editable draft from the agent's proposed value. State lives here so
  // the reviewer's edits persist across re-renders until they submit.
  const [draft, setDraft] = useState<EditDraft>(() =>
    parseEditable(decision.field, decision.after),
  );
  // Approve sends the agent's original value; Save sends the reviewer's edits.
  const dirty = serializeEditable(draft) !== decision.after;
  const submitting = fetcher.state !== "idle";

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
                states. Edit the suggestion on the right to remove a claim before
                approving.
              </s-text>
              {factCheck.addedClaims.map((claim, i) => (
                <s-text key={i}>• {claim}</s-text>
              ))}
            </s-stack>
          )}
        </s-section>
      )}

      <s-section heading="Before / after">
        <s-text color="subdued">
          The suggestion on the right is editable. Change the wording, then save
          your edited version below, or approve the agent's version as-is.
        </s-text>
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
            <s-heading>After (editable)</s-heading>
            <AfterEditor draft={draft} onChange={setDraft} />
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-section heading="Decide">
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            disabled={submitting || !dirty}
            onClick={() =>
              fetcher.submit(
                { verdict: "edit", editedValue: serializeEditable(draft) },
                { method: "post" },
              )
            }>
            Save edited version
          </s-button>
          <s-button
            disabled={submitting}
            onClick={() => fetcher.submit({ verdict: "agree" }, { method: "post" })}>
            Approve as-is
          </s-button>
          <s-button variant="secondary"
            disabled={submitting}
            onClick={() => fetcher.submit({ verdict: "reject" }, { method: "post" })}>
            Reject
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
