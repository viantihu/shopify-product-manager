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
