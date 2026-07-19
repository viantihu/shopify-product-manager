// app/lib/marketing-guidelines.ts
//
// Generic marketing best-practice guidelines the marketing-optimizer recipe
// applies, grounded in Shopify's "9 simple ways to write product descriptions
// that sell". This is the merchant-editable knob: a marketer tunes the copy
// strategy by editing THIS file (or, later, a UI that writes to it) — the recipe
// module reads from here and never hard-codes guidance. Mirrors the shape of
// lib/formatting-levels.ts (const arrays + accessors).
//
// The article's techniques split into two kinds, and this file honors the app's
// no-fabrication invariant by keeping them apart:
//
//   REWRITE_GUIDELINES — reframings the recipe can apply using ONLY facts the
//   merchant already wrote. No new claim is introduced, so the facts-only
//   rewrite pass may act on these directly.
//
//   COACHING_CHECKS — best practices that require information the description
//   does not contain (a testimonial, a sensory detail, an origin story). The
//   recipe must NOT invent these; instead it surfaces them as reviewer-facing
//   coaching notes for a human (the merchant) to fill in. They never enter the
//   shipped copy.
//
// Deliberately EXCLUDED (owned by other recipes / out of scope), so the
// boundaries between recipes stay clean:
//   - Scannable structure / headings / bullets  -> description-formatter
//   - SEO keywords, meta description             -> seo-meta-generator
//   - Setting & measuring KPIs                   -> out of product scope

// Guidelines the facts-only rewrite pass APPLIES. Each reframes copy the
// merchant already wrote — it introduces no new fact.
export const REWRITE_GUIDELINES = [
  "Lead with the value proposition: open with the single most compelling reason to buy that the copy already supports, not with specs or brand boilerplate.",
  "Reframe features as benefits: for each feature already stated, say what it does for the shopper — but invent no new feature, outcome, or number.",
  "Address the shopper directly in the second person (\"you\", \"your\") instead of abstract third-person product talk.",
  "Cut generic filler: replace empty phrases like \"high quality\", \"great value\", or \"premium\" with the concrete, already-stated detail that earns them; if no such detail exists, delete the phrase rather than invent one.",
  "Soften or strip unsupported superlatives: keep \"best\", \"most advanced\", and similar claims only when the original text already provides the supporting fact; otherwise remove the claim.",
  "Prefer concrete, specific wording over vague adjectives, using only specifics present in the source.",
  "Keep sentences tight and scannable: break a feature-dump run-on into shorter sentences without adding or dropping any fact.",
] as const;

// Checks that become REVIEWER-FACING coaching notes. Each names a best practice
// that needs merchant input, so the rewrite must NOT auto-write it — it is
// advice for a human, never shipped copy.
export const COACHING_CHECKS = [
  "No social proof present — a customer testimonial, review count, or rating would build trust here.",
  "No sensory language — a detail about how the product looks, feels, tastes, smells, or sounds would help the shopper imagine owning it.",
  "No product story — an origin, inspiration, or who-it-is-for hook would make the description more memorable.",
  "A bold or superlative claim lacks proof — a supporting fact, stat, or quote (merchant-supplied) would back it up.",
  "The copy does not speak to a specific ideal customer — naming the buyer's situation or objection (merchant knowledge) would sharpen it.",
] as const;

export type RewriteGuideline = (typeof REWRITE_GUIDELINES)[number];
export type CoachingCheck = (typeof COACHING_CHECKS)[number];

/** Render the rewrite guidelines as prompt-ready bullet text. */
export function rewriteGuidelinesText(): string {
  return REWRITE_GUIDELINES.map((g) => `- ${g}`).join("\n");
}

/** Render the coaching checks as prompt-ready bullet text. */
export function coachingChecksText(): string {
  return COACHING_CHECKS.map((c) => `- ${c}`).join("\n");
}
