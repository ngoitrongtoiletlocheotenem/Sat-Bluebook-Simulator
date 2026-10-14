import { defineConfig, devices } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';

// Each run uses its own database and a generated administrator password.
// No test credentials or test attempts enter the normal local deployment.
process.env.PLAYWRIGHT_ADMIN_PASSWORD ||= randomBytes(24).toString('base64url');
process.env.PLAYWRIGHT_ADMIN_EMAIL ||= 'e2e-admin@pathwise.invalid';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/e2e-results.xml' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      SQLITE_PATH: `./.runtime/e2e-${randomUUID()}.sqlite`,
      DATABASE_URL: '',
      APP_ORIGIN: 'http://127.0.0.1:5173',
      PORT: '3001',
      ADMIN_EMAIL: process.env.PLAYWRIGHT_ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      VITE_DESMOS_API_KEY: '',
      SEED_SAMPLE_DATA: 'true',
    },
  },
});
