// app/routes/app.product.$productId.tsx
//
// Per-product composed review. Shows every recipe that ran for one product as a
// single review: ONE rich-text description (all recipes' contributions folded to
// one seed) plus the non-description fields as separate editable pieces. The
// reviewer edits, then writes everything back in one action.
//
// Every field write flows through applyReviewedDecision (app/harness/apply.ts) —
// the single human-review funnel — so this page never writes to Shopify
// directly and every write stays anchored to a gated Decision row.
import { useState } from "react";
import { useLoaderData, useFetcher, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  listDecisionsForProduct,
  updateDecision,
} from "../harness/decisions.server";
import * as writers from "../lib/product.server";
import { applyReviewedDecision } from "../harness/apply";
import { composeProductReview } from "../lib/product-review";
import { productGid } from "../lib/product-changes";
import { sanitizeHtml } from "../lib/sanitize";
import { allowedTagsFor } from "../lib/formatting-levels";
import { RichTextEditor } from "../components/RichTextEditor";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const productId = productGid(params.productId!);
  if (!productId) throw new Response("Not found", { status: 404 });
  const decisions = await listDecisionsForProduct(productId);
  const composition = composeProductReview(decisions);
  if (composition.productId === "") throw new Response("Not found", { status: 404 });
  return { composition };
}

// Field values arrive from the form already in each writer's shape (HTML for the
// description, JSON for seo/alt, raw text for productType). The action re-reads
// and re-composes from the DB so a stale double-submit writes nothing: a piece
// already settled since page load is simply absent from the fresh composition.
export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const productId = productGid(params.productId!);
  if (!productId) throw new Response("Not found", { status: 404 });

  const form = await request.formData();

  // --- Advisory verdict (description-validator flag): no-write, inline. ---
  // Dismiss (false alarm) or Acknowledge (real mismatch, reviewer fixes it
  // manually) settle the flag without ever calling a writer — mirrors the
  // `reject` path in app.decision.$id.tsx. Guarded on the field and staged
  // status so a stale double-submit can't re-stamp or touch another row.
  const advisoryAction = form.get("advisory_action");
  if (advisoryAction === "dismissed" || advisoryAction === "acknowledged") {
    const advisoryId = String(form.get("advisory_id") ?? "");
    const row = advisoryId ? await db.decision.findUnique({ where: { id: advisoryId } }) : null;
    if (
      row &&
      row.productId === productId &&
      row.field === "descriptionMatch" &&
      row.status === "staged"
    ) {
      await db.decision.update({
        where: { id: row.id },
        data: { status: advisoryAction, reviewerVerdict: advisoryAction, reviewedAt: new Date() },
      });
    }
    return redirect("/app");
  }

  const decisions = await listDecisionsForProduct(productId);
  const c = composeProductReview(decisions);

  // One instant for the whole product submit → a soft audit grouping across the
  // fields written together.
  const reviewedAt = new Date();
  const deps = { writers, updateDecision, admin: admin.graphql };

  // A field is written only if the reviewer opted in (checkbox present) AND it
  // still has a live editable piece in the fresh composition. verdict "edit"
  // when the submitted value differs from the piece's seed, else "agree".
  const wants = (field: string) => form.get(`apply_${field}`) === "on";

  // --- Description (the composed piece) ---
  if (c.description && wants("description")) {
    const raw = String(form.get("description") ?? c.description.seed);
    const finalValue = sanitizeHtml(raw, allowedTagsFor("Full"));
    await applyReviewedDecision({
      decision: { id: c.description.decisionId, productId, field: "descriptionHtml" },
      verdict: finalValue === c.description.seed ? "agree" : "edit",
      finalValue,
      reviewedAt,
      deps,
    });
    // Supersede any losing description decision (a competing staged rewrite, or
    // an already-applied formatter). It is never written to — the winner shipped
    // the composed HTML; this only records that it was subsumed.
    for (const loserId of c.description.loserDecisionIds) {
      await updateDecision(loserId, {
        status: "superseded",
        reviewerVerdict: "superseded",
        finalValue,
        reviewedAt,
      });
    }
  }

  // --- productType / seo ---
  for (const piece of [c.productType, c.seo]) {
    if (!piece || !wants(piece.field)) continue;
    const finalValue = String(form.get(piece.field) ?? piece.value);
    await applyReviewedDecision({
      decision: { id: piece.decisionId, productId, field: piece.field },
      verdict: finalValue === piece.value ? "agree" : "edit",
      finalValue,
      reviewedAt,
      deps,
    });
  }

  // --- image alt text (one decision per image) ---
  for (const alt of c.imageAltText) {
    if (!wants(`alt_${alt.decisionId}`)) continue;
    const newAlt = String(form.get(`alt_${alt.decisionId}`) ?? alt.alt);
    const finalValue = JSON.stringify({ mediaId: alt.mediaId, alt: newAlt });
    await applyReviewedDecision({
      decision: { id: alt.decisionId, productId, field: "imageAltText" },
      verdict: newAlt === alt.alt ? "agree" : "edit",
      finalValue,
      reviewedAt,
      deps,
    });
  }

  return redirect("/app");
}

export default function ProductReview() {
  const { composition: c } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";

  // Local editable state seeded from the composition.
  const [descHtml, setDescHtml] = useState(c.description?.seed ?? "");
  const seoInit = c.seo ? safeParseSeo(c.seo.value) : { title: "", description: "" };
  const [seoTitle, setSeoTitle] = useState(seoInit.title);
  const [seoDesc, setSeoDesc] = useState(seoInit.description);
  const [productType, setProductType] = useState(c.productType?.value ?? "");
  const [alts, setAlts] = useState<Record<string, string>>(
    Object.fromEntries(c.imageAltText.map((a) => [a.decisionId, a.alt])),
  );

  function submit() {
    const data: Record<string, string> = {};
    if (c.description) {
      data.apply_description = "on";
      data.description = descHtml;
    }
    if (c.productType) {
      data.apply_productType = "on";
      data.productType = productType;
    }
    if (c.seo) {
      data.apply_seo = "on";
      data.seo = JSON.stringify({ title: seoTitle, description: seoDesc });
    }
    for (const a of c.imageAltText) {
      data[`apply_alt_${a.decisionId}`] = "on";
      data[`alt_${a.decisionId}`] = alts[a.decisionId] ?? "";
    }
    fetcher.submit(data, { method: "post" });
  }

  return (
    <s-page heading={`Review: ${c.productTitle}`}>
      {!c.hasStaged && (
        <s-section>
          <s-text>Nothing staged for this product.</s-text>
        </s-section>
      )}

      {c.advisories.map((adv) => (
        <AdvisoryFlag key={adv.decisionId} advisory={adv} />
      ))}

      {c.description && (
        <s-section heading="Description">
          {c.description.factCheck && !c.description.factCheck.factsPreserved && (
            <s-stack direction="block" gap="base">
              <s-badge tone="critical">Fabrication flagged</s-badge>
              <s-text>
                The rewrite added claims the original never states. Remove them
                before applying.
              </s-text>
              {c.description.factCheck.addedClaims.map((claim, i) => (
                <s-text key={i}>• {claim}</s-text>
              ))}
            </s-stack>
          )}
          <s-grid gridTemplateColumns="1fr 1fr" gap="large">
            <s-grid-item>
              <s-heading>Before</s-heading>
              <iframe
                title="description-before"
                sandbox=""
                srcDoc={c.description.before ?? ""}
                style={{ width: "100%", minHeight: "220px", border: "1px solid #ddd" }}
              />
            </s-grid-item>
            <s-grid-item>
              <s-heading>After (editable)</s-heading>
              <RichTextEditor value={c.description.seed} onChange={setDescHtml} />
            </s-grid-item>
          </s-grid>
        </s-section>
      )}

      {c.productType && (
        <s-section heading="Product type">
          <s-text-field
            label="Product type"
            value={productType}
            onChange={(e) => setProductType((e.target as HTMLInputElement).value)}
          />
        </s-section>
      )}

      {c.seo && (
        <s-section heading="SEO">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="SEO title"
              value={seoTitle}
              onChange={(e) => setSeoTitle((e.target as HTMLInputElement).value)}
            />
            <s-text-area
              label="SEO description"
              rows={3}
              value={seoDesc}
              onChange={(e) => setSeoDesc((e.target as HTMLTextAreaElement).value)}
            />
          </s-stack>
        </s-section>
      )}

      {c.imageAltText.length > 0 && (
        <s-section heading="Image alt text">
          <s-stack direction="block" gap="base">
            {c.imageAltText.map((a) => (
              <s-text-field
                key={a.decisionId}
                label={`Alt text (${a.mediaId.split("/").pop()})`}
                value={alts[a.decisionId] ?? ""}
                onChange={(e) =>
                  setAlts((prev) => ({
                    ...prev,
                    [a.decisionId]: (e.target as HTMLInputElement).value,
                  }))
                }
              />
            ))}
          </s-stack>
        </s-section>
      )}

      {c.settled.length > 0 && (
        <s-section heading="Also ran">
          <s-stack direction="block" gap="small-200">
            {c.settled.map((s) => (
              <s-stack key={s.decisionId} direction="inline" gap="base" alignItems="center">
                <s-badge tone="neutral">{s.status}</s-badge>
                <s-text color="subdued">{s.recipe}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      {c.hasWritable && (
        <s-section>
          <s-button variant="primary" disabled={submitting} onClick={submit}>
            Apply to product
          </s-button>
        </s-section>
      )}
    </s-page>
  );
}

// A review-only mismatch flag from the description-validator. It is never
// written: the reviewer Dismisses it (false alarm) or Acknowledges it (real
// mismatch, they'll fix the copy manually). Both settle the flag via a no-write
// status update in the action, so this uses its own fetcher independent of the
// main "Apply to product" form.
function AdvisoryFlag({
  advisory,
}: {
  advisory: { decisionId: string; reason: string; evidence: string[]; before: string | null };
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";
  const settle = (action: "dismissed" | "acknowledged") =>
    fetcher.submit(
      { advisory_action: action, advisory_id: advisory.decisionId },
      { method: "post" },
    );
  return (
    <s-section heading="Description check">
      <s-stack direction="block" gap="base">
        <s-badge tone="critical">Possible wrong-product description</s-badge>
        <s-text>{advisory.reason}</s-text>
        {advisory.evidence.length > 0 && (
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">What flagged it:</s-text>
            {advisory.evidence.map((e, i) => (
              <s-text key={i}>• {e}</s-text>
            ))}
          </s-stack>
        )}
        <s-heading>Flagged description</s-heading>
        <iframe
          title={`advisory-before-${advisory.decisionId}`}
          sandbox=""
          srcDoc={advisory.before ?? ""}
          style={{ width: "100%", minHeight: "160px", border: "1px solid #ddd" }}
        />
        <s-text color="subdued">
          This is not rewritten automatically. Dismiss if it is a false alarm, or
          acknowledge it and correct the copy in Shopify yourself.
        </s-text>
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            disabled={submitting}
            onClick={() => settle("acknowledged")}
          >
            Acknowledge
          </s-button>
          <s-button
            variant="secondary"
            disabled={submitting}
            onClick={() => settle("dismissed")}
          >
            Dismiss
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

// SEO value is stored as JSON { title, description }; tolerate a malformed row.
function safeParseSeo(value: string): { title: string; description: string } {
  try {
    const v = JSON.parse(value) as { title?: string; description?: string };
    return { title: v.title ?? "", description: v.description ?? "" };
  } catch {
    return { title: "", description: "" };
  }
}
