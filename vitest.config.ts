import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Tests share the hng-shop database — run files one at a time.
    fileParallelism: false,
    // Real network calls to Supabase.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      // Plus the mobile app's framework-free modules (the rest of mobile/ is React Native UI).
      include: ["src/**/*.ts", "mobile/src/lib/api.ts", "mobile/src/lib/money.ts"],
      // src/components holds UI (verified in the browser); ui.ts there is only class strings.
      exclude: ["src/**/*.test.ts", "src/lib/database.types.ts", "src/components/**"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
