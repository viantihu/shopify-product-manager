// app/routes/app.decision.$id.tsx
import { useState } from "react";
import { useLoaderData, useFetcher, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDecision, updateDecision } from "../harness/decisions.server";
import * as writers from "../lib/product.server";
import { applyReviewedDecision } from "../harness/apply";
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

  // Reject performs no write, so it stays inline — it never touched a writer.
  if (verdict === "reject") {
    await db.decision.update({
      where: { id: decision.id },
      data: { status: "rejected", reviewerVerdict: "reject", reviewedAt: new Date() },
    });
    return redirect("/app");
  }

  // A description-validator flag (field `descriptionMatch`) is review-only and
  // has NO writer — routing it through applyReviewedDecision would 500 in
  // performWrite ("No writer for field descriptionMatch"). Its only verdicts are
  // the two no-write settles, handled inline exactly like reject.
  if (verdict === "dismissed" || verdict === "acknowledged") {
    await db.decision.update({
      where: { id: decision.id },
      data: { status: verdict, reviewerVerdict: verdict, reviewedAt: new Date() },
    });
    return redirect("/app");
  }

  // Approve/edit write through the single human-review funnel in apply.ts, which
  // performs the field write AND records the verdict — the same helper the
  // per-product review page uses, so this route no longer writes to Shopify
  // directly.
  const finalValue =
    verdict === "edit" && editedValue != null ? String(editedValue) : decision.after;
  await applyReviewedDecision({
    decision,
    verdict: verdict === "edit" ? "edit" : "agree",
    finalValue,
    reviewedAt: new Date(),
    deps: { writers, updateDecision, admin: admin.graphql },
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

  // A description-validator flag is review-only: no editor, no write verdicts.
  // The reviewer Dismisses (false alarm) or Acknowledges (real mismatch, fix it
  // manually in Shopify) — both settle the row with a no-write status update.
  if (decision.field === "descriptionMatch") {
    return <AdvisoryDetail decision={decision} fetcher={fetcher} />;
  }

  const isHtml = decision.field === "descriptionHtml";
  const factCheck = decision.factCheck
    ? (JSON.parse(decision.factCheck) as { factsPreserved: boolean; addedClaims: string[] })
    : null;
  const coachingNotes = decision.coachingNotes
    ? (JSON.parse(decision.coachingNotes) as string[])
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

      {coachingNotes && coachingNotes.length > 0 && (
        <s-section heading="Marketing coaching">
          <s-text color="subdued">
            Best practices this description could add, but which need your input.
            These are NOT part of the suggested copy — the agent never invents
            them. Add them yourself where they fit.
          </s-text>
          <s-stack direction="block" gap="base">
            {coachingNotes.map((note, i) => (
              <s-text key={i}>• {note}</s-text>
            ))}
          </s-stack>
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

// The advisory-only fallback for a description-validator flag reached via this
// single-decision route (only when the gid can't form a product URL). It mirrors
// the advisory section on the per-product page: reason + evidence + the flagged
// copy, with the two no-write verdicts. There is deliberately no editor and no
// write path — a mismatch has nothing correct to write.
function AdvisoryDetail({
  decision,
  fetcher,
}: {
  decision: Awaited<ReturnType<typeof loader>>["decision"];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const submitting = fetcher.state !== "idle";
  let reason = decision.agentReason;
  let evidence: string[] = [];
  try {
    const parsed = JSON.parse(decision.after) as { reason?: string; evidence?: string[] };
    if (parsed.reason) reason = parsed.reason;
    if (Array.isArray(parsed.evidence)) evidence = parsed.evidence;
  } catch {
    // keep agentReason fallback
  }

  return (
    <s-page heading={`Review: ${decision.recipe}`}>
      <s-section heading="Description check">
        <s-stack direction="block" gap="base">
          <s-badge tone="critical">Possible wrong-product description</s-badge>
          <s-text>{reason}</s-text>
          {evidence.length > 0 && (
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">What flagged it:</s-text>
              {evidence.map((e, i) => (
                <s-text key={i}>• {e}</s-text>
              ))}
            </s-stack>
          )}
          <s-heading>Flagged description</s-heading>
          <iframe
            title="advisory-before"
            sandbox=""
            srcDoc={decision.before ?? ""}
            style={{ width: "100%", minHeight: "200px", border: "1px solid #ddd" }}
          />
          <s-text color="subdued">
            This is not rewritten automatically. Dismiss if it is a false alarm,
            or acknowledge it and correct the copy in Shopify yourself.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Decide">
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            disabled={submitting}
            onClick={() => fetcher.submit({ verdict: "acknowledged" }, { method: "post" })}
          >
            Acknowledge
          </s-button>
          <s-button
            variant="secondary"
            disabled={submitting}
            onClick={() => fetcher.submit({ verdict: "dismissed" }, { method: "post" })}
          >
            Dismiss
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
