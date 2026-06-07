import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// jsdom for the whole suite: pure-logic lib tests (*.test.ts) don't touch the
// DOM but run fine here, and component tests (*.test.tsx) need it. React plugin
// + "@" alias so component tests can import @/components/ui/*.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
