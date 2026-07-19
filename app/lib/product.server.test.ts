// app/lib/product.server.test.ts
//
// Covers readProductSkus' response parsing — the one bit of product.server.ts
// with branching logic worth pinning (SKU extraction, the +N-more count, and
// the skip rules for unresolved/empty rows). The write helpers are thin
// productUpdate wrappers exercised end-to-end elsewhere.
import { describe, it, expect, vi } from "vitest";
import { readProductSkus } from "./product.server";

// A fake admin.graphql: records the variables it was called with and returns a
// caller-supplied response body wrapped as a Response, matching the real client.
function fakeAdmin(body: unknown) {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const admin = vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => {
    calls.push({ query, variables: options?.variables });
    return new Response(JSON.stringify(body));
  });
  return { admin, calls };
}

describe("readProductSkus", () => {
  it("short-circuits on empty input without a network call", async () => {
    const { admin } = fakeAdmin({ data: { nodes: [] } });
    const out = await readProductSkus(admin, []);
    expect(out).toEqual([]);
    expect(admin).not.toHaveBeenCalled();
  });

  it("extracts the first variant's SKU and passes the ids through", async () => {
    const { admin, calls } = fakeAdmin({
      data: {
        nodes: [
          {
            id: "gid://shopify/Product/1",
            variantsCount: { count: 1 },
            variants: { nodes: [{ sku: "ABC-123" }] },
          },
        ],
      },
    });
    const out = await readProductSkus(admin, ["gid://shopify/Product/1"]);
    expect(out).toEqual([{ productId: "gid://shopify/Product/1", sku: "ABC-123", additionalCount: 0 }]);
    expect(calls[0].variables).toEqual({ ids: ["gid://shopify/Product/1"] });
  });

  it("reports additionalCount = variantsCount - 1 for multi-variant products", async () => {
    const { admin } = fakeAdmin({
      data: {
        nodes: [
          {
            id: "gid://shopify/Product/2",
            variantsCount: { count: 4 },
            variants: { nodes: [{ sku: "SHIRT-S" }] },
          },
        ],
      },
    });
    const [row] = await readProductSkus(admin, ["gid://shopify/Product/2"]);
    expect(row).toEqual({ productId: "gid://shopify/Product/2", sku: "SHIRT-S", additionalCount: 3 });
  });

  it("normalizes a missing or blank SKU to null", async () => {
    const { admin } = fakeAdmin({
      data: {
        nodes: [
          { id: "gid://shopify/Product/3", variantsCount: { count: 1 }, variants: { nodes: [{ sku: null }] } },
          { id: "gid://shopify/Product/4", variantsCount: { count: 1 }, variants: { nodes: [{ sku: "   " }] } },
          { id: "gid://shopify/Product/5", variantsCount: { count: 0 }, variants: { nodes: [] } },
        ],
      },
    });
    const out = await readProductSkus(admin, [
      "gid://shopify/Product/3",
      "gid://shopify/Product/4",
      "gid://shopify/Product/5",
    ]);
    expect(out.map((r) => r.sku)).toEqual([null, null, null]);
  });

  it("skips unresolved ids and non-Product nodes (no id on the node)", async () => {
    const { admin } = fakeAdmin({
      data: {
        nodes: [
          null, // id resolved to nothing
          {}, // e.g. a non-Product node — no id after the inline fragment
          { id: "gid://shopify/Product/9", variantsCount: { count: 2 }, variants: { nodes: [{ sku: "OK" }] } },
        ],
      },
    });
    const out = await readProductSkus(admin, ["a", "b", "gid://shopify/Product/9"]);
    expect(out).toEqual([{ productId: "gid://shopify/Product/9", sku: "OK", additionalCount: 1 }]);
  });
});
