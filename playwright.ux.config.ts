import { defineConfig, devices } from '@playwright/test';

// AC/1 UX quality gate: every static route at six widths. See tests/ux/ux-gate.spec.ts.
export default defineConfig({
  testDir: './tests/ux',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100',
    trace: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @corridra/web start --port 3100',
        url: 'http://127.0.0.1:3100',
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
