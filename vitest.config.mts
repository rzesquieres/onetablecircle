import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "supabase/tests/**/*.test.ts"],
    environment: "node",
    // Each database test file starts its own in-memory Postgres (PGlite);
    // running several at once crashes worker processes on Windows.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
