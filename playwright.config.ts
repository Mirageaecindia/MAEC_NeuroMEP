import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Frontend smoke tests (WBS 1.5.2). Playwright starts its own API and web server on spare ports,
 * with a fresh in-process MongoDB and data folder, so a running `npm run dev` (5173 / 4000) and its
 * data are never touched. With E2E_BASE_URL set (e.g. http://localhost:8080 for the Docker stack,
 * docker/README.md) the tests run against that site instead and no server is started.
 */
const API_PORT = 4100;
const WEB_PORT = 5273;
const BASE_URL = process.env.E2E_BASE_URL;
const DATA_DIR = BASE_URL ? '' : mkdtempSync(join(tmpdir(), 'neuromep-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL ?? `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: BASE_URL
    ? []
    : [
        {
          command: 'npm run dev -w @neuromep/api',
          url: `http://localhost:${API_PORT}/api/health`,
          env: { API_PORT: String(API_PORT), DATA_DIR, MONGODB_URI: '' },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `npm run dev -w @neuromep/web -- --port ${WEB_PORT} --strictPort`,
          url: `http://localhost:${WEB_PORT}`,
          env: { API_PORT: String(API_PORT) },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
