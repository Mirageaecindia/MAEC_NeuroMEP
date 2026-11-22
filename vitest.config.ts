import { defineConfig } from 'vitest/config';

// One Vitest run over every workspace; each workspace has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    // Off (23 Nov 2026): the on-disk module cache (node_modules/.vitest-cache) kept stale
    // transforms between runs - whole screen suites then failed with "Invalid Chai property"
    // until the cache was deleted. Cold starts are a little slower without it.
    fsModuleCache: false,
    // And no stored run results (which reorder the next run): with them the same stale state
    // came back after a run until node_modules/.vite/vitest was removed (23 Nov 2026).
    cache: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/testing.ts', '**/test-setup.ts'],
      // Design doc Section 6: engine coverage at least 90 %.
      thresholds: {
        'packages/engine/src/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});
