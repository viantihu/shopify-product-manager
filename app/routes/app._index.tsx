import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { FORMATTING_LEVELS, DEFAULT_LEVEL } from "../lib/formatting-levels";

interface FormatResult {
  original: string;
  formatted: string;
  changes: string[];
  warning: string | null;
}

/** Render already-sanitized HTML inside a locked-down iframe. */
function HtmlPreview({ html }: { html: string }) {
  return (
    <iframe
      title="preview"
      sandbox=""
      srcDoc={html}
      style={{
        width: "100%",
        minHeight: "240px",
        border: "1px solid #ddd",
        borderRadius: "8px",
      }}
    />
  );
}

export default function Index() {
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const [productId, setProductId] = useState<string | null>(null);
  const [productTitle, setProductTitle] = useState<string>("");
  const [level, setLevel] = useState<string>(DEFAULT_LEVEL);
  // Persist the formatted result across save/apply submits (those responses
  // carry a different intent, so we can't derive the preview from fetcher.data).
  const [result, setResult] = useState<FormatResult | null>(null);

  const data = fetcher.data as
    | {
        ok: boolean;
        intent?: string;
        result?: FormatResult;
        roundTripped?: boolean;
        applied?: boolean;
        error?: string;
      }
    | undefined;

  const busy = fetcher.state !== "idle";

  // When a format response arrives, capture it into state.
  useEffect(() => {
    if (data?.intent === "format" && data.ok && data.result) {
      setResult(data.result);
    }
  }, [data]);

  async function pickProduct() {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
    });
    if (selected && selected[0]) {
      setProductId(selected[0].id);
      setProductTitle(selected[0].title);
    }
  }

  function runFormat() {
    if (!productId) return;
    setResult(null); // drop any prior preview while the new one is generated
    fetcher.submit(
      { intent: "format", productId, level },
      { method: "post", action: "/app/format" },
    );
  }

  function saveDraft() {
    if (!productId || !result) return;
    fetcher.submit(
      { intent: "save", productId, formattedHtml: result.formatted },
      { method: "post", action: "/app/format" },
    );
  }

  function applyLive() {
    if (!productId || !result) return;
    // Overwrites the customer-facing description — confirm before doing it.
    const ok = window.confirm(
      "Replace the live product description with this formatted version? " +
        "This overwrites the current description shown to customers.",
    );
    if (!ok) return;
    fetcher.submit(
      { intent: "apply", productId, formattedHtml: result.formatted },
      { method: "post", action: "/app/format" },
    );
  }

  return (
    <s-page heading="AI Description Formatter">
      <s-section heading="1. Choose a product">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-button onClick={pickProduct}>Select product</s-button>
          {productTitle ? <s-text>{productTitle}</s-text> : null}
        </s-stack>
      </s-section>

      <s-section heading="2. Formatting level">
        <s-stack direction="block" gap="base" alignItems="start">
          <s-stack direction="inline" gap="base">
            {FORMATTING_LEVELS.map((l) => (
              <s-button
                key={l}
                variant={l === level ? "primary" : "secondary"}
                onClick={() => setLevel(l)}
              >
                {l}
              </s-button>
            ))}
          </s-stack>
          <s-button
            variant="primary"
            onClick={runFormat}
            disabled={!productId || busy}
            loading={busy}
          >
            Format description
          </s-button>
        </s-stack>
      </s-section>

      {result ? (
        <s-section heading="3. Before / after">
          {result.warning ? (
            <s-banner tone="warning">{result.warning}</s-banner>
          ) : null}
          <s-grid gridTemplateColumns="1fr 1fr" gap="large">
            <s-grid-item>
              <s-heading>Original</s-heading>
              <HtmlPreview html={result.original} />
            </s-grid-item>
            <s-grid-item>
              <s-heading>Formatted</s-heading>
              <HtmlPreview html={result.formatted} />
            </s-grid-item>
          </s-grid>

          <s-section heading="What changed">
            {result.changes.length ? (
              <s-unordered-list>
                {result.changes.map((c, i) => (
                  <s-list-item key={i}>{c}</s-list-item>
                ))}
              </s-unordered-list>
            ) : (
              <s-text>No structural changes were needed.</s-text>
            )}
          </s-section>

          <s-stack direction="block" gap="base" alignItems="start">
            <s-text type="strong">Choose what to do with this version:</s-text>
            <s-stack direction="inline" gap="base">
              <s-button variant="secondary" onClick={saveDraft} disabled={busy}>
                Save as draft
              </s-button>
              <s-button variant="primary" onClick={applyLive} disabled={busy}>
                Apply to live description
              </s-button>
            </s-stack>
            <s-text color="subdued">
              Draft saves to a metafield for review and leaves the live
              description untouched. Apply overwrites the customer-facing
              description.
            </s-text>

            {data?.intent === "save" && data.ok ? (
              <s-banner tone={data.roundTripped ? "success" : "critical"}>
                {data.roundTripped
                  ? "Saved to the draft metafield and verified the round trip. The live description is unchanged."
                  : "Saved, but the read-back did not match."}
              </s-banner>
            ) : null}
            {data?.intent === "apply" && data.ok ? (
              <s-banner tone={data.applied ? "success" : "critical"}>
                {data.applied
                  ? "Applied to the live product description and verified."
                  : "Update sent, but the saved description did not match."}
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}
