// app/lib/product.server.ts
type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface ProductImage {
  mediaId: string; // gid://shopify/MediaImage/...
  url: string;
  altText: string | null;
}

export interface ProductSnapshot {
  id: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  seoTitle: string;
  seoDescription: string;
  images: ProductImage[];
}

/** Read everything the agent and recipes need for one product. */
export async function readProduct(
  admin: AdminGraphql,
  productId: string,
): Promise<ProductSnapshot> {
  const res = await admin(
    `#graphql
    query ReadProduct($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        productType
        vendor
        seo { title description }
        media(first: 20) {
          nodes {
            ... on MediaImage {
              id
              alt
              image { url }
            }
          }
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const body = await res.json();
  const p = body.data.product;
  const images: ProductImage[] = (p.media?.nodes ?? [])
    .filter((n: { id?: string }) => Boolean(n?.id))
    .map((n: { id: string; alt: string | null; image?: { url?: string } }) => ({
      mediaId: n.id,
      url: n.image?.url ?? "",
      altText: n.alt ?? null,
    }));
  return {
    id: p.id,
    title: p.title ?? "",
    descriptionHtml: p.descriptionHtml ?? "",
    productType: p.productType ?? "",
    vendor: p.vendor ?? "",
    seoTitle: p.seo?.title ?? "",
    seoDescription: p.seo?.description ?? "",
    images,
  };
}

async function productUpdate(
  admin: AdminGraphql,
  input: Record<string, unknown>,
): Promise<void> {
  const res = await admin(
    `#graphql
    mutation Apply($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }`,
    { variables: { product: input } },
  );
  const body = await res.json();
  const errors = body.data.productUpdate.userErrors;
  if (errors.length > 0) {
    throw new Error(`productUpdate failed: ${JSON.stringify(errors)}`);
  }
}

export function writeDescription(
  admin: AdminGraphql,
  productId: string,
  html: string,
): Promise<void> {
  return productUpdate(admin, { id: productId, descriptionHtml: html });
}

export function writeProductType(
  admin: AdminGraphql,
  productId: string,
  productType: string,
): Promise<void> {
  return productUpdate(admin, { id: productId, productType });
}

/** Title + description written together to avoid nulling the unspecified one. */
export function writeSeo(
  admin: AdminGraphql,
  productId: string,
  seo: { title: string; description: string },
): Promise<void> {
  return productUpdate(admin, { id: productId, seo });
}

/**
 * Update alt text on one product image via its MediaImage id.
 *
 * Uses `fileUpdate`: `productUpdateMedia` is deprecated as of API 2025-10 and
 * will be removed when that version is retired. `fileUpdate` keys off the file's
 * own id, so `productId` is no longer needed by the mutation; it stays in the
 * signature for caller stability.
 */
export async function writeImageAlt(
  admin: AdminGraphql,
  productId: string,
  mediaId: string,
  alt: string,
): Promise<void> {
  void productId;
  const res = await admin(
    `#graphql
    mutation SetAlt($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) {
        files { ... on MediaImage { id alt } }
        userErrors { field message }
      }
    }`,
    { variables: { files: [{ id: mediaId, alt }] } },
  );
  const body = await res.json();
  const errors = body.data.fileUpdate.userErrors;
  if (errors.length > 0) {
    throw new Error(`fileUpdate failed: ${JSON.stringify(errors)}`);
  }
}
