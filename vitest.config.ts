import { defineConfig } from 'vitest/config';

// One Vitest run over every workspace; each workspace has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
