import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@droploop/pipeline": "D:/DropLoop/packages/pipeline/src/index.ts",
      "@droploop/prompts": "D:/DropLoop/packages/prompts/src/index.ts",
      "@droploop/schemas": "D:/DropLoop/packages/schemas/src/index.ts"
    }
  }
});
