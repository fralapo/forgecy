import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites share one database and some change global settings (the default
    // AI policy), so test files run one after another.
    fileParallelism: false,
  },
});
