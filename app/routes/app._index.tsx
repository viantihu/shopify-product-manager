import { useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { FORMATTING_LEVELS, DEFAULT_LEVEL } from "../lib/formatting-levels";

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

  const data = fetcher.data as
    | {
        ok: boolean;
        intent?: string;
        result?: {
          original: string;
          formatted: string;
          changes: string[];
          warning: string | null;
        };
        roundTripped?: boolean;
        error?: string;
      }
    | undefined;

  const busy = fetcher.state !== "idle";
  const result = data?.intent === "format" && data.ok ? data.result : undefined;

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
    fetcher.submit(
      { intent: "format", productId, level },
      { method: "post", action: "/app/format" },
    );
  }

  function save() {
    if (!productId || !result) return;
    fetcher.submit(
      { intent: "save", productId, formattedHtml: result.formatted },
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

          <s-button variant="primary" onClick={save} disabled={busy}>
            Save formatted draft
          </s-button>
          {data?.intent === "save" && data.ok ? (
            <s-banner tone={data.roundTripped ? "success" : "critical"}>
              {data.roundTripped
                ? "Saved to draft metafield and verified round trip."
                : "Saved, but the read-back did not match."}
            </s-banner>
          ) : null}
        </s-section>
      ) : null}
    </s-page>
  );
}
