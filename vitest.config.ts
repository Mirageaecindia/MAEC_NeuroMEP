import { defineConfig } from 'vitest/config';

// One Vitest run over every workspace; each workspace has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
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
