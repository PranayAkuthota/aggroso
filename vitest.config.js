import { defineConfig } from "vitest/config";
import "dotenv/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
