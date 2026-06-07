import { defineConfig } from "vitest/config";

// Pure-logic unit tests run in node (no DOM, no Tailwind/React plugins needed).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
