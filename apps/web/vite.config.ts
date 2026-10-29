import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';

export default defineConfig({
  ...sourceConditions,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 4000}` },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // Screen tests click through whole pages; under a parallel full run they need more than 5 s.
    testTimeout: 15_000,
  },
});
