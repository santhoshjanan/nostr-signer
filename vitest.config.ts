import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/main/**", "src/shared/**"]
    },
    alias: [
      {
        find: "electron",
        replacement: fileURLToPath(new URL("./tests/helpers/electron-stub.ts", import.meta.url))
      }
    ]
  }
});
