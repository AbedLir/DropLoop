import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@droploop/media": resolve(__dirname, "packages/media/src/index.ts"),
      "@droploop/pipeline": resolve(__dirname, "packages/pipeline/src/index.ts"),
      "@droploop/prompts": resolve(__dirname, "packages/prompts/src/index.ts"),
      "@droploop/schemas": resolve(__dirname, "packages/schemas/src/index.ts")
    }
  }
});
