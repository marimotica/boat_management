import { defineConfig } from "vitest/config";

// Unit/component tests for the panel. We deliberately run in a pure-Node DOM
// (happy-dom) rather than a real browser: the integration must stay installable
// and testable offline with no headless-Chrome download, matching the
// local-first reliability ethos of the rest of the project.
//
// Decorator handling (experimentalDecorators / useDefineForClassFields:false)
// is inherited from frontend/tsconfig.json, which Vite/esbuild reads when
// transforming the Lit sources — keep those two compilers in agreement.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    // Explicit imports from "vitest" instead of globals keep the production
    // tsconfig (src-only) free of test typings.
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The esbuild bundle entry and pure type modules carry no logic worth
      // covering; everything else is fair game.
      exclude: ["src/main.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
