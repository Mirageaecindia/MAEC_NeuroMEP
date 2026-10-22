import { defineConfig } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';

export default defineConfig({
  ...sourceConditions,
  test: { name: 'engine', include: ['src/**/*.test.ts'] },
});
