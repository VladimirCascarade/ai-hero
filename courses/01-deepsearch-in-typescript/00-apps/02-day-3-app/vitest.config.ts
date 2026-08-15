import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    setupFiles: ["dotenv/config"],
    testTimeout: 160_000,
    sequence: {
      concurrent: false,
    },
  },
  plugins: [tsconfigPaths()],
});
