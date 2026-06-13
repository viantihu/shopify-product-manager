import type { ProductContext } from "./format-prompt";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export const DRAFT_METAFIELD_NAMESPACE = "custom";
export const DRAFT_METAFIELD_KEY = "formatted_description_draft";

export interface ProductForFormatting {
  id: string;
  descriptionHtml: string;
  context: ProductContext;
}

/** Read the fields the formatter needs for one product. */
export async function getProduct(
  admin: AdminGraphql,
  productId: string,
): Promise<ProductForFormatting> {
  const response = await admin(
    `#graphql
    query GetProduct($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        productType
        vendor
      }
    }`,
    { variables: { id: productId } },
  );
  const body = await response.json();
  const p = body.data.product;
  return {
    id: p.id,
    descriptionHtml: p.descriptionHtml ?? "",
    context: {
      title: p.title ?? "",
      productType: p.productType ?? "",
      vendor: p.vendor ?? "",
    },
  };
}

/** Write formatted HTML to the draft metafield, then read it back. */
export async function saveDraftAndReadBack(
  admin: AdminGraphql,
  productId: string,
  formattedHtml: string,
): Promise<string | null> {
  const write = await admin(
    `#graphql
    mutation SetDraft($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: DRAFT_METAFIELD_NAMESPACE,
            key: DRAFT_METAFIELD_KEY,
            type: "multi_line_text_field",
            value: formattedHtml,
          },
        ],
      },
    },
  );
  const writeBody = await write.json();
  const errors = writeBody.data.metafieldsSet.userErrors;
  if (errors.length > 0) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(errors)}`);
  }

  const read = await admin(
    `#graphql
    query ReadDraft($id: ID!) {
      product(id: $id) {
        metafield(namespace: "${DRAFT_METAFIELD_NAMESPACE}", key: "${DRAFT_METAFIELD_KEY}") {
          value
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const readBody = await read.json();
  return readBody.data.product.metafield?.value ?? null;
}

/**
 * Apply formatted HTML to the LIVE product description (productUpdate). This
 * overwrites the customer-facing description — the UI gates it behind an explicit
 * confirm. Returns the persisted descriptionHtml so the caller can verify.
 */
export async function applyToDescription(
  admin: AdminGraphql,
  productId: string,
  formattedHtml: string,
): Promise<string> {
  const res = await admin(
    `#graphql
    mutation ApplyDescription($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id descriptionHtml }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        product: { id: productId, descriptionHtml: formattedHtml },
      },
    },
  );
  const body = await res.json();
  const errors = body.data.productUpdate.userErrors;
  if (errors.length > 0) {
    throw new Error(`productUpdate failed: ${JSON.stringify(errors)}`);
  }
  return body.data.productUpdate.product.descriptionHtml;
}

/**
 * Create the draft metafield definition so the saved draft is visible in the
 * product's Metafields panel in the admin. Idempotent: a "definition already
 * exists" (TAKEN) error is treated as success, so it is safe to call on every
 * install via the afterAuth hook.
 */
export async function ensureDraftMetafieldDefinition(
  admin: AdminGraphql,
): Promise<void> {
  const res = await admin(
    `#graphql
    mutation CreateDraftDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        definition: {
          name: "Formatted description (draft)",
          namespace: DRAFT_METAFIELD_NAMESPACE,
          key: DRAFT_METAFIELD_KEY,
          description:
            "AI-formatted product description, saved as a draft for review before applying to the live description.",
          type: "multi_line_text_field",
          ownerType: "PRODUCT",
        },
      },
    },
  );
  const body = await res.json();
  const errors = body.data.metafieldDefinitionCreate.userErrors as Array<{
    code?: string;
    message: string;
  }>;
  // TAKEN means the definition already exists from a prior install — that's fine.
  const blocking = errors.filter((e) => e.code !== "TAKEN");
  if (blocking.length > 0) {
    throw new Error(
      `metafieldDefinitionCreate failed: ${JSON.stringify(blocking)}`,
    );
  }
}
