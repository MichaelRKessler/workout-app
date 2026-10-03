import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.vitest.ts"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
