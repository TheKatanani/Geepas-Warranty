import { defineConfig } from "vitest/config";

/**
 * Standalone from vite.config.ts on purpose — the Remix vite plugin does
 * route-file discovery/build steps that aren't needed (and can misbehave)
 * under Vitest's Node test environment. Test files only import plain
 * TS/route modules directly, so no bundler plugins are required.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["app/**/*.test.ts"],
  },
});
