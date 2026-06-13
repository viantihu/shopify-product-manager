import { defineConfig } from "vitest/config";

// Standalone Vitest config — deliberately does NOT load the reactRouter() Vite
// plugin from vite.config.ts. The unit tests cover pure logic (formatting
// levels, the HTML sanitizer, prompt assembly, formatter post-processing) and
// run in a plain Node environment with no Shopify/React Router context.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
    // Vitest 4 exits non-zero when no test files match. Don't fail the script
    // before the first test exists (e.g. this bootstrap commit).
    passWithNoTests: true,
  },
});
