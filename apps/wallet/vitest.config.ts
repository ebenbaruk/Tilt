import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database tests share one Postgres and truncate it between tests.
    fileParallelism: false,
  },
});
