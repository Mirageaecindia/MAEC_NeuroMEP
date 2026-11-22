import { defineConfig } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';

export default defineConfig({
  ...sourceConditions,
  test: {
    name: 'rulepacks',
    fsModuleCache: false,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
