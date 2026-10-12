import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.vitest.ts", "tests/**/*.vitest.tsx"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});