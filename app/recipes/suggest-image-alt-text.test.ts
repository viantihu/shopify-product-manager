// app/recipes/suggest-image-alt-text.test.ts
import { describe, it, expect } from "vitest";
import { toProposal } from "./suggest-image-alt-text";

describe("image-alt-text toProposal", () => {
  it("encodes mediaId + alt and references the image in the reason", () => {
    const p = toProposal({
      mediaId: "gid://shopify/MediaImage/5",
      alt: "Black water bottle on a desk",
    });
    expect(p.recipe).toBe("image-alt-text");
    expect(p.field).toBe("imageAltText");
    expect(JSON.parse(p.after)).toEqual({
      mediaId: "gid://shopify/MediaImage/5",
      alt: "Black water bottle on a desk",
    });
    expect(p.textPreserved).toBe(true);
  });
});
